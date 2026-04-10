"""仅在配置 E2E_SMOKE_SECRET 时挂载；供 CI 串起播客 fixture→RSS。"""

from fastapi import APIRouter, Header, HTTPException

from ..e2e_smoke import run_smoke_chain, verify_e2e_secret

router = APIRouter(prefix="/api/v1/e2e", tags=["e2e"])


@router.post("/smoke-chain")
def post_smoke_chain(x_e2e_token: str | None = Header(default=None, alias="X-E2E-Token")):
    if not verify_e2e_secret(x_e2e_token):
        raise HTTPException(status_code=404, detail="not_found")
    return run_smoke_chain()
