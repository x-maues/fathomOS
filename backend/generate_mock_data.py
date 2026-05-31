import json
import random
from datetime import datetime, timedelta

def generate_timestamp(base_time, offset_minutes=0):
    dt = base_time + timedelta(minutes=offset_minutes)
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")

base_time = datetime(2026, 5, 26, 10, 0, 0)
services = ["auth-service", "payment-gateway", "user-db", "billing-service", "notification-worker", "search-api", "inventory-db"]
repositories = ["coral-auth", "coral-payments", "coral-users", "coral-billing", "coral-notifications", "coral-search", "coral-inventory"]
users = ["dev-pirate", "ops-ninja", "data-wizard", "sec-expert", "frontend-guru", "backend-boss"]

# THE NEEDLE IN THE HAYSTACK: A SEV-1 incident caused by a Redis upgrade breaking auth-service
incident_service = "auth-service"
incident_repo = "coral-auth"
incident_time = base_time + timedelta(minutes=15) # 10:15
pr_time = base_time - timedelta(minutes=30) # 09:30

def generate_pagerduty():
    data = []
    # Noise
    for i in range(1, 201):
        data.append({
            "incident_number": str(1000 + i),
            "title": random.choice(["High CPU Usage", "Memory Warning", "Elevated Latency", "Database Connection Drops", "Queue Backup"]),
            "service": random.choice(services),
            "repository": random.choice(repositories),
            "urgency": random.choice(["low", "high"]),
            "created_at": generate_timestamp(base_time, random.randint(-120, 120))
        })
    # The Needle
    data.append({
        "incident_number": "1042",
        "title": "API latency spike in us-east-1",
        "service": incident_service,
        "repository": incident_repo,
        "urgency": "high",
        "created_at": generate_timestamp(incident_time, 0)
    })
    random.shuffle(data)
    with open("/home/maues/Arbeit/kraken/backend/mock_data/pagerduty.jsonl", "w") as f:
        for row in data: f.write(json.dumps(row) + "\n")

def generate_sentry():
    data = []
    # Noise
    for i in range(1, 301):
        data.append({
            "issue_id": f"SEN-{800 + i}",
            "error_message": random.choice(["NullPointerException in handler", "Timeout querying downstream", "Invalid token format", "Rate limit exceeded"]),
            "service": random.choice(services),
            "level": random.choice(["warning", "error", "fatal"]),
            "first_seen": generate_timestamp(base_time, random.randint(-120, 120))
        })
    # The Needle
    data.append({
        "issue_id": "SEN-842",
        "error_message": "Redis connection timeout",
        "service": incident_service,
        "level": "fatal",
        "first_seen": generate_timestamp(incident_time, -3) # 10:12
    })
    random.shuffle(data)
    with open("/home/maues/Arbeit/kraken/backend/mock_data/sentry.jsonl", "w") as f:
        for row in data: f.write(json.dumps(row) + "\n")

def generate_github():
    data = []
    # Noise
    for i in range(1, 101):
        data.append({
            "pr_number": 50 + i,
            "title": random.choice(["fix: typo in readme", "chore: update dependencies", "feat: add new endpoint", "refactor: cleanup unused vars"]),
            "repository": random.choice(repositories),
            "merged_at": generate_timestamp(base_time, random.randint(-1000, 120)),
            "author": random.choice(users)
        })
    # The Needle
    data.append({
        "pr_number": 89,
        "title": "feat: upgrade redis client library",
        "repository": incident_repo,
        "merged_at": generate_timestamp(pr_time, 0), # 09:30
        "author": "dev-pirate"
    })
    random.shuffle(data)
    with open("/home/maues/Arbeit/kraken/backend/mock_data/github.jsonl", "w") as f:
        for row in data: f.write(json.dumps(row) + "\n")

def generate_datadog():
    data = []
    # Noise
    for i in range(1, 401):
        data.append({
            "metric_id": f"metric_{i}",
            "metric_name": random.choice(["system.cpu.system", "system.mem.used", "trace.express.request.duration"]),
            "service": random.choice(services),
            "value": round(random.uniform(10.0, 95.0), 2),
            "timestamp": generate_timestamp(base_time, random.randint(-120, 120))
        })
    # The Needle
    data.append({
        "metric_id": "metric_401",
        "metric_name": "trace.redis.command.duration",
        "service": incident_service,
        "value": 5000.45, # 5 seconds!
        "timestamp": generate_timestamp(incident_time, -2) # 10:13
    })
    random.shuffle(data)
    with open("/home/maues/Arbeit/kraken/backend/mock_data/datadog.jsonl", "w") as f:
        for row in data: f.write(json.dumps(row) + "\n")

def generate_statusgator():
    data = []
    # Noise
    for i in range(1, 51):
        data.append({
            "status_id": f"sg_{i}",
            "provider_name": random.choice(["AWS", "Stripe", "Twilio", "SendGrid", "Cloudflare"]),
            "status": random.choice(["minor_outage", "major_outage", "maintenance"]),
            "reported_at": generate_timestamp(base_time, random.randint(-2000, -100)) # old outages
        })
    # The Needle (No needle actually, StatusGator is fine, but maybe AWS ElastiCache had a hiccup?)
    data.append({
        "status_id": "sg_51",
        "provider_name": "AWS ElastiCache",
        "status": "minor_outage",
        "reported_at": generate_timestamp(pr_time, -10) # 09:20
    })
    random.shuffle(data)
    with open("/home/maues/Arbeit/kraken/backend/mock_data/statusgator.jsonl", "w") as f:
        for row in data: f.write(json.dumps(row) + "\n")

if __name__ == "__main__":
    generate_pagerduty()
    generate_sentry()
    generate_github()
    generate_datadog()
    generate_statusgator()
    print("Successfully generated massive JSONL mock datasets.")
