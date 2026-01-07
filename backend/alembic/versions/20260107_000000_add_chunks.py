"""Add chunks and chunk_words tables

Revision ID: 002_add_chunks
Revises: 001_initial
Create Date: 2026-01-07 00:12:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '002_add_chunks'
down_revision: Union[str, None] = '001_initial'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Chunks table - consolidated transcript chunks
    op.create_table(
        'chunks',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('speaker_id', sa.String(36), sa.ForeignKey('speakers.id', ondelete='SET NULL'), nullable=True),
        sa.Column('start_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('end_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('text', sa.Text, nullable=False, server_default=''),
        # Lineage tracking
        sa.Column('source_segment_ids', sa.JSON, nullable=True),
        # Edit state
        sa.Column('is_edited', sa.Boolean, nullable=False, server_default='false'),
        sa.Column('is_filler', sa.Boolean, nullable=False, server_default='false'),
        # Algorithm versioning
        sa.Column('algo_version', sa.String(16), nullable=False, server_default='v1.0'),
        # Timestamps
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_chunks_project_id', 'chunks', ['project_id'])
    op.create_index('ix_chunks_speaker_id', 'chunks', ['speaker_id'])

    # ChunkWords junction table - links chunks to original words for word-level timing
    op.create_table(
        'chunk_words',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('chunk_id', sa.String(36), sa.ForeignKey('chunks.id', ondelete='CASCADE'), nullable=False),
        sa.Column('word_id', sa.String(36), sa.ForeignKey('words.id', ondelete='CASCADE'), nullable=False),
        sa.Column('order_index', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_chunk_words_chunk_id', 'chunk_words', ['chunk_id'])
    op.create_index('ix_chunk_words_word_id', 'chunk_words', ['word_id'])


def downgrade() -> None:
    op.drop_table('chunk_words')
    op.drop_table('chunks')
