-- Kangen Water Facebook Auto-Post Database Schema
-- PostgreSQL Database Schema

-- Drop table if exists (for clean reinstall)
DROP TABLE IF EXISTS kangen_posts;

-- Create main posts table
CREATE TABLE kangen_posts (
    id SERIAL PRIMARY KEY,
    topic VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    image_url VARCHAR(500),
    hashtags VARCHAR(500),
    facebook_post_id VARCHAR(255),
    status VARCHAR(50) DEFAULT 'scheduled',
    posted_at TIMESTAMP,
    engagement_likes INT DEFAULT 0,
    engagement_comments INT DEFAULT 0,
    engagement_shares INT DEFAULT 0,
    error_message TEXT,
    retry_count INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes for better query performance
CREATE INDEX idx_status ON kangen_posts(status);
CREATE INDEX idx_posted_at ON kangen_posts(posted_at DESC);
CREATE INDEX idx_topic ON kangen_posts(topic);

-- Create function to automatically update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = CURRENT_TIMESTAMP;
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Create trigger to automatically update updated_at
CREATE TRIGGER update_kangen_posts_updated_at
    BEFORE UPDATE ON kangen_posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Insert comment for documentation
COMMENT ON TABLE kangen_posts IS 'Stores all Kangen Water Facebook posts with status tracking and engagement metrics';
COMMENT ON COLUMN kangen_posts.status IS 'Post status: scheduled, generating, posting, posted, failed';
COMMENT ON COLUMN kangen_posts.retry_count IS 'Number of retry attempts for failed posts';
