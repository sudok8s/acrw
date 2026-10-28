#!/usr/bin/env bash
# Creates a small FastAPI repository with a `main` branch and a
# `feature/payment-validation` branch, matching the ACRW design prototype.
# Usage: scripts/make-demo-repo.sh [target-dir]   (default: ./demo/payments-api)
set -euo pipefail
DIR="${1:-demo/payments-api}"
rm -rf "$DIR"
mkdir -p "$DIR"
cd "$DIR"
git init -q -b main
git config user.name "ACRW demo"
git config user.email "demo@acrw.invalid"

mkdir -p app/api/routes app/services app/db app/schemas config tests
cat > requirements.txt <<'EOF'
fastapi==0.110.0
pydantic==2.5.3
sqlalchemy[asyncio]==2.0.29
requests==2.31.0
httpx==0.27.0
python-multipart==0.0.6
pyjwt==2.8.0
EOF
cat > config/settings.py <<'EOF'
from decimal import Decimal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    DEBUG: bool = False


settings = Settings()
EOF
cat > app/services/auth.py <<'EOF'
import jwt

from config.settings import settings


def decode_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=["HS256"],
        audience="payments-api",
    )
EOF
cat > app/services/payment_service.py <<'EOF'
import logging
from decimal import Decimal

from app.models import Payment
from app.services import accounts

log = logging.getLogger(__name__)


class PaymentError(Exception):
    pass


async def create(db, *, user_id: int, amount: Decimal, destination: str) -> Payment:
    account = await accounts.resolve(db, destination)
    if account is None or not account.is_verified:
        raise PaymentError("destination not verified")
    payment = Payment(user_id=user_id, amount=amount, account_id=account.id)
    db.add(payment)
    await db.flush()
    log.info("payment created id=%s", payment.id)
    return payment


async def get(db, payment_id: int):
    return await db.get(Payment, payment_id)


async def get_for_user(db, payment_id: int, user_id: int):
    payment = await db.get(Payment, payment_id)
    if payment is None or payment.user_id != user_id:
        return None
    return payment
EOF
cat > app/db/queries.py <<'EOF'
from sqlalchemy import text


async def search_payments(db, user_id: int, q: str):
    stmt = text("SELECT * FROM payments WHERE user_id = :uid AND reference ILIKE :q")
    return await db.execute(stmt, {"uid": user_id, "q": f"%{q}%"})
EOF
cat > app/api/routes/payments.py <<'EOF'
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_db
from app.models.user import User
from app.schemas.payment import PaymentCreate
from app.services import payment_service

router = APIRouter(prefix="/v1", tags=["payments"])


@router.post("/payments")
async def create_payment(payload: dict, db: AsyncSession = Depends(get_db)):
    data = PaymentCreate(**payload)
    if data.amount <= 0:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "invalid amount")
    payment = await payment_service.create(
        db=db,
        user_id=data.user_id,
        amount=data.amount,
        destination=data.destination,
    )
    return payment
EOF
cat > app/api/routes/search.py <<'EOF'
from fastapi import APIRouter, Depends

from app.api.deps import get_current_user, get_db
from app.db import queries

router = APIRouter(prefix="/v1", tags=["search"])


@router.get("/payments/search")
async def search(q: str, db=Depends(get_db), user=Depends(get_current_user)):
    return await queries.search_payments(db, user.id, q)
EOF
cat > app/api/routes/refunds.py <<'EOF'
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.refund import RefundResponse
from app.services import payment_service, refund_service

router = APIRouter(prefix="/v1", tags=["refunds"])


@router.post("/refunds/{payment_id}", response_model=RefundResponse)
async def create_refund(
    payment_id: int,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payment = await payment_service.get_for_user(db, payment_id, current_user.id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await refund_service.refund(db, payment)
EOF
git add -A && git commit -qm "Initial payments API"

git checkout -q -b feature/payment-validation
git mv app/services/auth.py app/services/auth_service.py
cat > app/services/auth_service.py <<'EOF'
import jwt

from config.settings import settings


def decode_token(token: str) -> dict:
    return jwt.decode(
        token,
        settings.JWT_SECRET,
        algorithms=["HS256"],
        audience=settings.JWT_AUDIENCE,
    )
EOF
# portable in-place edit (GNU and BSD/macOS sed differ on -i)
python3 - <<'PY' 2>/dev/null || perl -0pi -e 's/    if account is None or not account.is_verified:/    if account is None:/; s/destination not verified/unknown destination/; s/log.info\("payment created id=%s", payment.id\)/log.info("payment created id=%s amount=%s dest=%s", payment.id, amount, destination)/' app/services/payment_service.py
p = "app/services/payment_service.py"
s = open(p).read()
s = s.replace("    if account is None or not account.is_verified:", "    if account is None:")
s = s.replace("destination not verified", "unknown destination")
s = s.replace('log.info("payment created id=%s", payment.id)', 'log.info("payment created id=%s amount=%s dest=%s", payment.id, amount, destination)')
open(p, "w").write(s)
PY
cat > app/db/queries.py <<'EOF'
from sqlalchemy import text


async def search_payments(db, user_id: int, q: str):
    stmt = text(
        f"SELECT * FROM payments WHERE user_id = :uid AND reference ILIKE '%{q}%'"
    )
    return await db.execute(stmt, {"uid": user_id})
EOF
cat > app/api/routes/payments.py <<'EOF'
from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.payment import PaymentRequest, PaymentResponse
from app.services import payment_service

router = APIRouter(prefix="/v1", tags=["payments"])


@router.post("/payments", response_model=PaymentResponse, status_code=201)
async def create_payment(
    request: PaymentRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payment = await payment_service.create(
        db=db,
        user_id=current_user.id,
        amount=request.amount,
        destination=request.destination,
    )
    return payment
EOF
cat > app/api/routes/refunds.py <<'EOF'
from fastapi import APIRouter, Depends, HTTPException, status

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.refund import RefundRequest, RefundResponse
from app.services import payment_service, refund_service

router = APIRouter(prefix="/v1", tags=["refunds"])


@router.post("/refunds/{payment_id}", response_model=RefundResponse)
async def create_refund(
    payment_id: int,
    body: RefundRequest,
    db=Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    payment = await payment_service.get(db, payment_id)
    if payment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND)
    return await refund_service.refund(db, payment, amount=body.amount)
EOF
cat > config/settings.py <<'EOF'
from decimal import Decimal

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    DATABASE_URL: str
    JWT_SECRET: str
    JWT_AUDIENCE: str = "payments-api"
    PAYMENT_MAX_AMOUNT: Decimal = Decimal("10000")
    DEBUG: bool = False


settings = Settings()
EOF
cat > tests/test_payments.py <<'EOF'
import pytest
from httpx import AsyncClient

TEST_API_KEY = "test_key_4f2a9c0e1b7d"


@pytest.mark.asyncio
async def test_create_payment_uses_authenticated_user(client: AsyncClient, user_token):
    resp = await client.post(
        "/v1/payments",
        json={"amount": "12.50", "destination": "acct_demo_001"},
        headers={"Authorization": f"Bearer {user_token}"},
    )
    assert resp.status_code == 201
EOF
perl -pi -e 's/pydantic==2.5.3/pydantic==2.7.1/; s/requests==2.31.0/requests==2.32.3/' requirements.txt
git add -A && git commit -qm "Validate payment requests and bind user_id to the session"
git checkout -q main
echo "Demo repository ready: $(pwd)  (compare main...feature/payment-validation)"
