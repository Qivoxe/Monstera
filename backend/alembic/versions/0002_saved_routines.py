"""Persist user-specific saved commute routines.

Revision ID: 0002_saved_routines
Revises: 0001_initial
"""
from alembic import op
import sqlalchemy as sa

revision = "0002_saved_routines"
down_revision = "0001_initial"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "saved_routines",
        sa.Column("id", sa.Uuid(), primary_key=True),
        sa.Column("user_id", sa.Uuid(), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(120), nullable=False),
        sa.Column("corridor_id", sa.String(80), nullable=False),
        sa.Column("routine_json", sa.JSON(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_routines_user_created", "saved_routines", ["user_id", "created_at"])


def downgrade():
    op.drop_index("ix_routines_user_created", table_name="saved_routines")
    op.drop_table("saved_routines")
