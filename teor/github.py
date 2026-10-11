"""Configurações limitadas ao Teor; políticas da organização não são efeito colateral."""

import json
import subprocess
from datetime import UTC, datetime
from typing import Any

REPO = "como-votam/teor"


def api(path: str, method: str = "GET", body: dict[str, Any] | None = None) -> Any:
    command = ["gh", "api", path, "--method", method]
    if body is not None:
        command.extend(["--input", "-"])
    proc = subprocess.run(
        command,
        input=json.dumps(body) if body is not None else None,
        capture_output=True,
        text=True,
        encoding="utf-8",
        check=False,
    )
    if proc.returncode:
        raise RuntimeError(proc.stderr.strip())
    return json.loads(proc.stdout) if proc.stdout.strip() else None


def audit() -> dict[str, Any]:
    state = api(f"repos/{REPO}")
    return {
        "repository": REPO,
        "description": state["description"],
        "homepage": state["homepage"],
        "topics": state.get("topics", []),
        "issues": state["has_issues"],
        "discussions": state["has_discussions"],
        "security": state.get("security_and_analysis"),
        "default_branch": state["default_branch"],
        "rulesets": api(f"repos/{REPO}/rulesets"),
    }


def apply() -> dict[str, Any]:
    before = audit()
    steps = []
    changes: list[tuple[str, str, dict[str, Any] | None]] = [
        (
            f"repos/{REPO}",
            "PATCH",
            {
                "description": "Benchmark aberto de LLMs para o processo legislativo brasileiro",
                "homepage": "https://teor.comovotam.com.br",
                "has_issues": True,
                "has_discussions": True,
                "security_and_analysis": {
                    "secret_scanning": {"status": "enabled"},
                    "secret_scanning_push_protection": {"status": "enabled"},
                },
            },
        ),
        (
            f"repos/{REPO}/topics",
            "PUT",
            {
                "names": [
                    "benchmark",
                    "llm",
                    "portuguese",
                    "legislative",
                    "open-data",
                    "civic-tech",
                    "inspect-ai",
                ]
            },
        ),
        (f"repos/{REPO}/vulnerability-alerts", "PUT", None),
        (f"repos/{REPO}/automated-security-fixes", "PUT", None),
        (f"repos/{REPO}/private-vulnerability-reporting", "PUT", None),
        (
            f"repos/{REPO}/actions/permissions/workflow",
            "PUT",
            {"default_workflow_permissions": "read", "can_approve_pull_request_reviews": False},
        ),
    ]
    for path, method, body in changes:
        try:
            api(path, method, body)
            steps.append({"path": path, "status": "applied"})
        except RuntimeError as exc:
            steps.append({"path": path, "status": "unavailable", "reason": str(exc)})
    rules = {
        "name": "teor-main",
        "target": "branch",
        "enforcement": "active",
        "conditions": {"ref_name": {"include": ["refs/heads/main"], "exclude": []}},
        "bypass_actors": [{"actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always"}],
        "rules": [
            {"type": "deletion"},
            {"type": "non_fast_forward"},
            {
                "type": "required_status_checks",
                "parameters": {
                    "strict_required_status_checks_policy": True,
                    "required_status_checks": [
                        {"context": "python"},
                        {"context": "site"},
                        {"context": "secrets"},
                    ],
                },
            },
        ],
    }
    existing = next((r for r in before["rulesets"] if r["name"] == rules["name"]), None)
    try:
        api(
            f"repos/{REPO}/rulesets" + (f"/{existing['id']}" if existing else ""),
            "PUT" if existing else "POST",
            rules,
        )
        steps.append({"path": "ruleset", "status": "applied"})
    except RuntimeError as exc:
        steps.append({"path": "ruleset", "status": "unavailable", "reason": str(exc)})
    try:
        try:
            api(f"repos/{REPO}/pages")
            method = "PUT"
        except RuntimeError as exc:
            if "404" not in str(exc):
                raise
            method = "POST"
        api(f"repos/{REPO}/pages", method, {"build_type": "workflow"})
        steps.append({"path": "pages", "status": "configured"})
    except RuntimeError as exc:
        steps.append(
            {
                "path": "pages",
                "status": "deferred",
                "reason": str(exc),
                "command": "uv run teor github apply",
            }
        )
    return {"at": datetime.now(UTC).isoformat(), "before": before, "steps": steps, "after": audit()}
