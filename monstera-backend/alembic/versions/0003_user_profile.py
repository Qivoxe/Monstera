"""Add user profile names and home location.

Revision ID: 0003_user_profile
Revises: 0002_saved_routines
"""
from alembic import op
import sqlalchemy as sa

revision = "0003_user_profile"
down_revision = "0002_saved_routines"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("users", sa.Column("display_name", sa.String(length=120), nullable=True))
    op.add_column("user_preferences", sa.Column("home_location", sa.String(length=160), nullable=True))
    op.add_column("user_preferences", sa.Column("home_latitude", sa.Float(), nullable=True))
    op.add_column("user_preferences", sa.Column("home_longitude", sa.Float(), nullable=True))


def downgrade():
    op.drop_column("user_preferences", "home_longitude")
    op.drop_column("user_preferences", "home_latitude")
    op.drop_column("user_preferences", "home_location")
    op.drop_column("users", "display_name")
