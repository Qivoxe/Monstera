"""Add account-scoped saved places.

Revision ID: 0004_saved_locations
Revises: 0003_user_profile
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "0004_saved_locations"
down_revision = "0003_user_profile"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    uuid_type = postgresql.UUID(as_uuid=True) if bind.dialect.name == "postgresql" else sa.Uuid()
    op.create_table(
        "saved_locations",
        sa.Column("id", uuid_type, nullable=False),
        sa.Column("user_id", uuid_type, nullable=False),
        sa.Column("name", sa.String(length=80), nullable=False),
        sa.Column("latitude", sa.Float(), nullable=False),
        sa.Column("longitude", sa.Float(), nullable=False),
        sa.Column("place_label", sa.String(length=160), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "name", name="uq_saved_location_user_name"),
    )
    op.create_index("ix_saved_locations_user_created", "saved_locations", ["user_id", "created_at"])


def downgrade():
    op.drop_index("ix_saved_locations_user_created", table_name="saved_locations")
    op.drop_table("saved_locations")
