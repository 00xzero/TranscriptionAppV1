"""Initial schema

Revision ID: 001_initial
Revises: 
Create Date: 2026-01-05 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '001_initial'
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Projects table
    op.create_table(
        'projects',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('title', sa.String(256), nullable=True),
        sa.Column('status', sa.String(32), nullable=False, server_default='created'),
        sa.Column('source_object_key', sa.String(512), nullable=True),
        sa.Column('duration_seconds', sa.Integer, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_projects_status', 'projects', ['status'])

    # Speakers table
    op.create_table(
        'speakers',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('label', sa.String(128), nullable=False),
        sa.Column('color', sa.String(32), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_speakers_project_id', 'speakers', ['project_id'])

    # Segments table
    op.create_table(
        'segments',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('speaker_id', sa.String(36), sa.ForeignKey('speakers.id', ondelete='SET NULL'), nullable=True),
        sa.Column('start_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('end_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('text', sa.Text, nullable=False, server_default=''),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_segments_project_id', 'segments', ['project_id'])
    op.create_index('ix_segments_speaker_id', 'segments', ['speaker_id'])

    # Words table
    op.create_table(
        'words',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('segment_id', sa.String(36), sa.ForeignKey('segments.id', ondelete='CASCADE'), nullable=False),
        sa.Column('start_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('end_ms', sa.Integer, nullable=False, server_default='0'),
        sa.Column('text', sa.String(256), nullable=False, server_default=''),
        sa.Column('confidence', sa.Float, nullable=True),
        sa.Column('order_index', sa.Integer, nullable=False, server_default='0'),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_words_segment_id', 'words', ['segment_id'])

    # Watchlist table
    op.create_table(
        'watchlist',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('term', sa.String(256), nullable=False),
        sa.Column('canonical', sa.String(256), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_watchlist_project_id', 'watchlist', ['project_id'])

    # Jobs table
    op.create_table(
        'jobs',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('project_id', sa.String(36), sa.ForeignKey('projects.id', ondelete='CASCADE'), nullable=False),
        sa.Column('celery_task_id', sa.String(64), nullable=True),
        sa.Column('type', sa.String(32), nullable=False, server_default='transcribe'),
        sa.Column('status', sa.String(32), nullable=False, server_default='queued'),
        sa.Column('payload', sa.JSON, nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
        sa.Column('started_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('finished_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_index('ix_jobs_project_id', 'jobs', ['project_id'])
    op.create_index('ix_jobs_celery_task_id', 'jobs', ['celery_task_id'])


def downgrade() -> None:
    op.drop_table('jobs')
    op.drop_table('watchlist')
    op.drop_table('words')
    op.drop_table('segments')
    op.drop_table('speakers')
    op.drop_table('projects')
