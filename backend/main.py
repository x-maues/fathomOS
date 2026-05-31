import os
import json
import subprocess
from datetime import datetime, timedelta, timezone
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from google import genai as google_genai
from dotenv import load_dotenv

load_dotenv()

_client = google_genai.Client(api_key=os.getenv("GEMINI_API_KEY"))
GEMINI_MODEL = "gemini-3.5-flash"


def _generate(prompt: str) -> str:
    response = _client.models.generate_content(model=GEMINI_MODEL, contents=prompt)
    return response.text.strip()

app = FastAPI(title="fathomOS AI SRE API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Schema — single source of truth, avoids hallucinated table/column names
# ---------------------------------------------------------------------------
SCHEMA = """
Available Coral SQL tables (PostgreSQL syntax):

  pagerduty.incidents
    - incident_number (TEXT)   - unique incident ID
    - title           (TEXT)   - short title
    - service         (TEXT)   - affected service name  ← join key
    - repository      (TEXT)   - associated repo        ← join key
    - urgency         (TEXT)   - 'high' | 'low'
    - created_at      (TEXT)   - ISO-8601 timestamp

  sentry.issues
    - issue_id        (TEXT)   - unique issue ID
    - error_message   (TEXT)   - error text
    - service         (TEXT)   - affected service name  ← join key
    - level           (TEXT)   - 'fatal' | 'error' | 'warning'
    - first_seen      (TEXT)   - ISO-8601 timestamp

  github_mock.pull_requests
    - pr_number       (INT)
    - title           (TEXT)   - PR title
    - repository      (TEXT)   - repo name              ← join key
    - merged_at       (TEXT)   - ISO-8601 timestamp (NULL if not merged)
    - author          (TEXT)

  datadog.metrics
    - metric_id      (TEXT)
    - metric_name    (TEXT)
    - service        (TEXT)   - service name
    - value          (Float64)
    - timestamp      (TEXT)   - ISO-8601 timestamp

  statusgator.outages
    - status_id      (TEXT)
    - provider_name  (TEXT)
    - status         (TEXT)
    - reported_at    (TEXT)   - ISO-8601 timestamp

JOIN strategy:
  sentry  ↔ pagerduty  : ON sentry.service = pagerduty.service
  github  ↔ pagerduty  : ON github.repository = pagerduty.repository
  github  ↔ sentry     : (no direct key — route through service/repository)
"""

# ---------------------------------------------------------------------------
# Request/Response models
# ---------------------------------------------------------------------------

class IncidentRequest(BaseModel):
    incident_title: str
    description: str
    service: str | None = None
    severity: str | None = None
    previous_sql: str | None = None

class ExecuteRequest(BaseModel):
    incident_title: str
    service: str | None = None
    severity: str | None = None
    sql_query: str


# ---------------------------------------------------------------------------
# Stage 1: deterministic first-pass SQL then LLM refinement
# ---------------------------------------------------------------------------

def generate_coral_sql(
    incident_title: str,
    description: str,
    service: str | None = None,
    severity: str | None = None,
    previous_sql: str | None = None,
) -> dict:
    """
    Always uses the LLM to generate or refine the Coral SQL query.
    """

    # Follow-up / no service → ask LLM to write or refine SQL.
    modification_context = ""
    if previous_sql:
        modification_context = f"""
This is an iterative follow-up. The PREVIOUS query was:
```sql
{previous_sql}
```
MODIFY it based on the operator command below. Do not restart from scratch unless the operator explicitly asks for a different service or scope.
"""

    service_hint = f"\nThe incident is on service: '{service}'." if service else ""
    severity_hint = f"\nSeverity: {severity}." if severity else ""

    prompt = f"""You are an expert SRE translating an incident investigation command into a Coral SQL query.

Incident title: {incident_title}
Operator command: {description}{service_hint}{severity_hint}
{modification_context}

{SCHEMA}

Rules:
- Write a SINGLE valid SQL query using ONLY the tables and columns listed above.
- To prove Coral's capability, you MUST attempt to JOIN multiple tables (e.g., JOIN sentry.issues and datadog.metrics) to find correlated evidence if starting from scratch.
- WARNING: Avoid Cartesian products! If you JOIN multiple tables on generic keys like 'service' or 'repository', you MUST add time-window constraints (e.g., `s.first_seen BETWEEN p.created_at - INTERVAL '1 hour' AND p.created_at + INTERVAL '1 hour'`) to correlate events chronologically.
- Do NOT alias primary ID columns (`incident_number`, `issue_id`, `pr_number`, `metric_id`, `status_id`). The UI requires these exact column names to render the evidence cards.
- Order results by the most relevant timestamp DESC. Use LIMIT 50.
- Return ONLY a JSON object with exactly two keys:
  "sql_query": the raw SQL string (nicely formatted with newlines)
  "evolution_reason": a 3-6 word description of what changed (e.g. "Joined 3 tables", "Filtered fatal Sentry errors")
- No markdown fences. Raw JSON only.
"""

    try:
        text = _generate(prompt)
        if text.startswith("```json"):
            text = text[7:].rstrip("`").strip()
        elif text.startswith("```"):
            text = text[3:].rstrip("`").strip()
        return json.loads(text)
    except Exception as e:
        print("SQL generation error:", e)
        return {
            "sql_query": "SELECT 'Error generating SQL' AS error;",
            "evolution_reason": "Generation failed",
        }


# ---------------------------------------------------------------------------
# Stage 2: execute via Coral CLI
# ---------------------------------------------------------------------------

def execute_coral_query(sql_query: str) -> dict:
    """Run `coral sql` and return parsed JSON rows."""
    try:
        result = subprocess.run(
            ["coral", "sql", sql_query, "--format", "json"],
            capture_output=True,
            text=True,
            timeout=30,
            check=True,
        )
        rows = json.loads(result.stdout)
        return {"success": True, "data": rows, "row_count": len(rows)}
    except subprocess.CalledProcessError as e:
        return {"success": False, "error": e.stderr.strip(), "data": []}
    except subprocess.TimeoutExpired:
        return {"success": False, "error": "Coral CLI timed out after 30s", "data": []}
    except Exception as e:
        return {"success": False, "error": str(e), "data": []}


# ---------------------------------------------------------------------------
# Stage 3: structured RCA — Gemini reasons over capped evidence
# ---------------------------------------------------------------------------

def _summarize_for_prompt(rows: list, max_rows: int = 20) -> str:
    """
    Cap data sent to Gemini to avoid token blowup.
    Prioritise: fatal > error > warning, most recent first.
    """
    if not rows:
        return "[]"

    level_rank = {"fatal": 0, "error": 1, "warning": 2}

    def sort_key(r: dict) -> tuple[int, str]:
        """
        Sort primarily by severity (fatal < error < warning),
        secondarily by timestamp string descending.
        We can't negate strings, so we sort ascending and reverse later,
        or use the timestamp as-is with reverse=True in sorted().
        """
        level = r.get("error_level") or r.get("level")
        if not level and r.get("urgency") is not None:
            # PagerDuty urgency is 'high'/'low'; map to approximate severity ranks.
            level = "error" if r.get("urgency") == "high" else "warning"
        level = level or "warning"

        ts = (
            r.get("first_seen")
            or r.get("incident_at")
            or r.get("created_at")
            or r.get("timestamp")
            or r.get("reported_at")
            or ""
        )
        return (level_rank.get(level, 3), ts)

    # Sort ascending by (severity_rank, timestamp) then reverse to get
    # highest severity & most recent first.
    sorted_rows = sorted(rows, key=sort_key, reverse=True)
    capped = sorted_rows[:max_rows]
    return json.dumps(capped, indent=2)


def analyze_root_cause(
    incident_title: str,
    service: str | None,
    severity: str | None,
    sql_query: str,
    rows: list,
) -> dict:
    """
    Produce a structured RCA JSON:
      hypothesis, confidence (0-100), key_evidence[], immediate_actions[], comms_draft
    """
    evidence_str = _summarize_for_prompt(rows, max_rows=20)
    row_count = len(rows)

    service_context = f" on service '{service}'" if service else ""
    severity_context = f" ({severity})" if severity else ""

    prompt = f"""You are fathomOS, an elite incident commander.
Incident: "{incident_title}"{service_context}{severity_context}

Coral SQL used:
```sql
{sql_query}
```

Evidence ({row_count} total rows, top {min(row_count, 20)} shown):
{evidence_str}

Analyze the evidence and return ONLY a raw JSON object (no markdown fences) with exactly these keys:

{{
  "hypothesis": "2-3 sentence dense paragraph: what broke, why, what triggered it. Cite specific issue IDs or PR numbers from the data.",
  "confidence": <integer 0-100 based on evidence quality and signal strength>,
  "key_evidence": [
    {{"source": "sentry|pagerduty|github", "id": "...", "detail": "one line why this matters"}}
  ],
  "immediate_actions": [
    "Concrete step 1 an on-call engineer should take RIGHT NOW",
    "Concrete step 2",
    "Concrete step 3"
  ],
  "comms_draft": "One paragraph customer/stakeholder update in plain English. Professional tone. State impact, what engineering is doing, next update time."
}}

Rules:
- confidence >= 80 only if multiple sources corroborate the same root cause.
- confidence 50-79 if partial evidence or only one source.
- confidence < 50 if evidence is noisy or inconclusive.
- key_evidence: include at most 5 items, most signal-rich first.
- immediate_actions: 3 actionable steps max. Be specific (e.g. "Roll back PR #89 in coral-auth").
- If data is empty or inconclusive, set confidence = 10 and say so in hypothesis.
"""

    try:
        text = _generate(prompt)
        if text.startswith("```json"):
            text = text[7:].rstrip("`").strip()
        elif text.startswith("```"):
            text = text[3:].rstrip("`").strip()
        return json.loads(text)
    except Exception as e:
        print("RCA generation error:", e)
        return {
            "hypothesis": "Analysis failed. Review raw evidence manually.",
            "confidence": 0,
            "key_evidence": [],
            "immediate_actions": ["Review raw evidence in the evidence panel."],
            "comms_draft": "Investigation in progress. Engineers reviewing evidence. Next update in 15 minutes.",
        }


# ---------------------------------------------------------------------------
# Build incident timeline from cross-source rows
# ---------------------------------------------------------------------------

def build_timeline(rows: list) -> list:
    """
    Extract timestamp events from all rows, deduplicate, sort chronologically.
    Returns list of {time, source, label, id} dicts.
    """
    events = []
    seen = set()

    for row in rows:
        candidates = [
            (row.get("first_seen"), "sentry", row.get("error_message", "Error"), row.get("issue_id")),
            (
                row.get("incident_at"),
                "pagerduty",
                row.get("incident_title") or row.get("title") or "Incident",
                row.get("incident_number"),
            ),
            (
                row.get("merged_at"),
                "github",
                row.get("pr_title") or row.get("title") or "PR merged",
                f"PR#{row.get('pr_number')}",
            ),
            (row.get("timestamp"), "datadog", row.get("metric_name") or "Metric", row.get("metric_id")),
            (row.get("reported_at"), "statusgator", row.get("provider_name") or "Provider", row.get("status_id")),
        ]
        for ts, source, label, uid in candidates:
            if ts and uid and uid not in seen:
                seen.add(uid)
                events.append({
                    "time": ts,
                    "source": source,
                    "label": label,
                    "id": str(uid),
                })

    events.sort(key=lambda e: e["time"])
    return events


# ---------------------------------------------------------------------------
# API endpoints
# ---------------------------------------------------------------------------

@app.post("/api/generate-sql")
async def generate_sql_endpoint(req: IncidentRequest):
    print(f"[generate-sql] Generating SQL for: {req.description[:80]}")
    
    # Attempt 1
    result = generate_coral_sql(
        req.incident_title,
        req.description,
        req.service,
        req.severity,
        req.previous_sql,
    )
    
    sql_query = result.get("sql_query", "")
    evolution_reason = result.get("evolution_reason", "")
    
    # SELF-HEALING LOOP
    # We test the query against Coral. If it fails, we ask Gemini to fix it.
    if sql_query and not sql_query.startswith("SELECT 'Error"):
        test_run = execute_coral_query(sql_query)
        if not test_run["success"]:
            print(f"[self-healing] Coral execution failed: {test_run['error']}. Retrying...")
            error_prompt = f"Your previous SQL query failed with this error from Coral:\n{test_run['error']}\n\nFix the SQL query so it is valid PostgreSQL syntax and perfectly matches the provided schema. Return the fixed JSON object."
            
            retry_result = generate_coral_sql(
                req.incident_title,
                error_prompt,
                req.service,
                req.severity,
                sql_query,
            )
            sql_query = retry_result.get("sql_query", sql_query)
            evolution_reason = "Self-healed syntax error"

    return {
        "status": "success",
        "sql_query": sql_query,
        "evolution_reason": evolution_reason,
    }


@app.post("/api/execute-investigation")
async def execute_investigation(req: ExecuteRequest):
    print(f"[execute-investigation] Executing raw Coral query...")

    execution = execute_coral_query(req.sql_query)

    if not execution["success"]:
        return {
            "status": "error",
            "sql_used": req.sql_query,
            "error": execution["error"],
            "row_count": 0,
            "raw_data_found": [],
            "timeline": [],
            "analysis": None,
            "stage_sql": [{"name": "AI Generated Query", "sql": req.sql_query}],
        }

    rows = execution["data"]
    row_count = len(rows)

    # Analyze Root Cause using the unified results
    analysis = analyze_root_cause(
        req.incident_title,
        req.service,
        req.severity,
        req.sql_query,
        rows,
    )
    
    timeline = build_timeline(rows)

    return {
        "status": "success",
        "sql_used": req.sql_query,
        "row_count": row_count,
        "raw_data_found": rows,
        "timeline": timeline,
        "analysis": analysis,
        "stage_sql": [{"name": "AI Generated Query", "sql": req.sql_query}],
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
