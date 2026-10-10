from datetime import datetime, timezone
import secrets

from fastapi import Depends, HTTPException, Request
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.session import get_db
from app.models import User, UserSession
from app.core.security import digest_secret


def current_auth(request: Request, db: Session = Depends(get_db)) -> tuple[User, UserSession]:
    token = request.cookies.get("monstera_session")
    if not token:
        raise HTTPException(status_code=401, detail="Sign in to use personal data features")
    session = db.scalar(select(UserSession).where(UserSession.token_hash == digest_secret(token)))
    now = datetime.now(timezone.utc)
    if session is None:
        raise HTTPException(status_code=401, detail="Session is invalid or expired")
    expiry = session.expires_at
    if expiry.tzinfo is None:
        expiry = expiry.replace(tzinfo=timezone.utc)
    if expiry <= now:
        db.delete(session)
        db.commit()
        raise HTTPException(status_code=401, detail="Session is invalid or expired")
    user = db.get(User, session.user_id)
    if user is None:
        raise HTTPException(status_code=401, detail="Session is invalid or expired")
    if request.method in {"POST", "PUT", "PATCH", "DELETE"}:
        csrf = request.headers.get("X-CSRF-Token", "")
        if not secrets.compare_digest(csrf, session.csrf_token):
            raise HTTPException(status_code=403, detail="CSRF validation failed")
    return user, session
