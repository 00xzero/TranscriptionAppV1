"""Add unique constraint on watchlist project_id + canonical

Revision ID: 003_watchlist_unique
Revises: 002_add_chunks
Create Date: 2026-01-07 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '003_watchlist_unique'
down_revision: Union[str, None] = '002_add_chunks'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Add unique constraint to enforce case-insensitive deduplication of key terms
    op.create_unique_constraint(
        'uq_watchlist_project_canonical',
        'watchlist',
        ['project_id', 'canonical']
    )


def downgrade() -> None:
    op.drop_constraint('uq_watchlist_project_canonical', 'watchlist', type_='unique')
