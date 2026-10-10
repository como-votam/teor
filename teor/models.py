"""Os contratos separam evidência, execução e publicação para não confundir fatos e alegações."""

from datetime import date, datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

from teor.io import CANARY

Chamber = Literal["camara", "senado"]
Split = Literal["dev", "test-public", "test-lite", "test-private", "test-live"]
PredictionStatus = Literal["ok", "invalid", "model_error", "infrastructure_error"]
Track = Literal["A", "B", "C", "D", "E", "F", "G", "H"]
Judgement = Literal["supported", "unsupported", "uncertain"]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")
    schema_version: Literal["1.0"] = "1.0"


class Evidence(Contract):
    ref: str
    url: str
    quote: str | None = None
    observed_at: datetime | None = None
    available_at: datetime | None = None


class Answer(Contract):
    type: Literal["string", "integer", "set", "sequence", "probability", "claims"]
    value: Any
    tolerance: float = Field(default=0, ge=0)

    @model_validator(mode="after")
    def valid_value(self) -> "Answer":
        if self.type == "integer" and (
            not isinstance(self.value, int) or isinstance(self.value, bool)
        ):
            raise ValueError("Gabarito inteiro inválido")
        if self.type == "probability" and self.value not in (0, 1):
            raise ValueError("O alvo de previsão deve ser binário")
        if self.type in ("set", "sequence", "claims") and not isinstance(self.value, list):
            raise ValueError("Gabarito deve ser uma lista")
        if self.type == "string" and not isinstance(self.value, str):
            raise ValueError("Gabarito deve ser texto")
        return self


class Item(Contract):
    id: str
    snapshot_id: str | None = None
    family: str
    track: Track
    task: str
    chamber: Chamber
    mode: Literal["with_context", "closed_book", "tools"] = "with_context"
    split: Split = "test-public"
    context: dict[str, Any]
    prompts: list[str] = Field(min_length=3, max_length=5)
    answer: Answer
    answerable: bool = True
    evidence: list[Evidence] = Field(min_length=1)
    source_date: date
    generator: str
    difficulty: Literal["easy", "medium", "hard"] = "medium"
    theme: str = "não informado"
    pair_id: str | None = None
    pair_variant: str | None = None
    cutoff: datetime | None = None
    temporal_quality: Literal["prospective", "historical_evidence", "retrospective"] | None = None
    experimental: bool = False
    baseline_probability: float | None = Field(default=None, ge=0, le=1)
    baseline_probabilities: dict[str, float] = Field(default_factory=dict)
    canary: str = CANARY


class PublicQuestion(Contract):
    id: str
    track: str
    task: str
    mode: str
    context: dict[str, Any]
    prompts: list[str]
    canary: str = CANARY


class SnapshotFile(Contract):
    path: str
    sha256: str
    url: str | None = None
    params: dict[str, Any] = Field(default_factory=dict)
    obtained_at: datetime | None = None


class Snapshot(Contract):
    id: str
    start: date
    end: date
    state: Literal["complete", "incomplete"]
    sources: list[str]
    files: list[SnapshotFile]
    coverage: dict[str, Any]
    gaps: list[dict[str, Any]]
    created_at: datetime
    canary: str = CANARY


class Prediction(Contract):
    item_id: str
    variant: int = Field(ge=0)
    run_id: str
    model: str
    response: Any = None
    abstain: bool = False
    status: PredictionStatus = "ok"
    input_tokens: int = Field(default=0, ge=0)
    output_tokens: int = Field(default=0, ge=0)
    latency_seconds: float | None = Field(default=None, ge=0)
    cost_usd: float | None = Field(default=None, ge=0)
    tool_calls: int = Field(default=0, ge=0)
    error: str | None = None


class Result(Contract):
    id: str
    model: str
    protocol_hash: str
    dataset_hash: str
    verification: Literal["autodeclarado", "verificado"] = "autodeclarado"
    verified_by: str | None = None
    verification_evidence: str | None = None
    complete: bool
    created_at: datetime
    config: dict[str, Any]
    metrics: list[dict[str, Any]]
    usage: dict[str, Any]
    canary: str = CANARY

    @model_validator(mode="after")
    def verification_requires_evidence(self) -> "Result":
        if self.verification == "verificado" and not (
            self.verified_by and self.verification_evidence
        ):
            raise ValueError("Resultado verificado exige responsável e evidência")
        return self


class Round(Contract):
    id: str
    opens_at: datetime
    closes_at: datetime
    state: Literal["open", "closed", "published"] = "open"
    dataset_hash: str
    published_at: datetime | None = None
    canary: str = CANARY

    @model_validator(mode="after")
    def dates_ordered(self) -> "Round":
        if self.closes_at <= self.opens_at:
            raise ValueError("Prazo deve ser posterior à abertura")
        if self.opens_at.tzinfo is None or self.closes_at.tzinfo is None:
            raise ValueError("Datas da rodada exigem fuso horário")
        return self


class Review(Contract):
    item_id: str
    item_hash: str | None = None
    reviewer: str
    judgement: Judgement
    evidence: str
    claim_index: int | None = Field(default=None, ge=0)
    prediction_id: str | None = None
    adjudication: bool = False
    reviewed_at: datetime

    @model_validator(mode="after")
    def substantiated(self) -> "Review":
        if not self.reviewer.strip() or not self.evidence.strip():
            raise ValueError("Revisão exige responsável e evidência")
        if (self.prediction_id is None) != (self.claim_index is None):
            raise ValueError("Revisão de afirmação exige previsão e índice juntos")
        return self
