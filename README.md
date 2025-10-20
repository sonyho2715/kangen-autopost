# Kangen Water Facebook Auto-Post System

Automated Facebook posting system that generates and posts health/wellness content about Kangen water 3 times daily using AI-generated content (OpenAI GPT) and images (DALL-E 3).

## Features

- 🤖 **AI-Generated Content**: Uses GPT-5-mini to create engaging, educational posts
- 🎨 **AI-Generated Images**: Creates beautiful images with DALL-E 3
- 📅 **Automated Scheduling**: Posts 3x daily at 6 AM, 12 PM, and 6 PM Hawaii time
- 🔄 **Topic Rotation**: Cycles through 10 health/wellness topics
- 💪 **Reliable Job Queue**: BullMQ with automatic retry and error handling
- 📊 **Database Tracking**: PostgreSQL for post history and analytics
- 🔍 **Health Monitoring**: Built-in health check and status endpoints

## Technology Stack

- **Node.js 18+**
- **Express.js** - API server
- **PostgreSQL** - Database
- **Redis** - Job queue backend
- **BullMQ** - Job queue management
- **OpenAI API** - GPT-5-mini + DALL-E 3
- **Facebook Graph API v18.0** - Facebook posting
- **node-cron** - Scheduling

## Project Structure

```
kangen-autopost/
├── lib/
│   ├── openai-generator.js    # GPT & DALL-E integration
│   ├── facebook-poster.js      # Facebook Graph API
│   ├── db.js                   # PostgreSQL client
│   └── queue.js                # BullMQ setup
├── workers/
│   ├── content-worker.js       # Content generation worker
│   ├── image-worker.js         # Image generation worker
│   └── publish-worker.js       # Facebook publishing worker
├── scheduler.js                # Cron job scheduler
├── app.js                      # Main application
├── test-post.js                # Manual test script
├── schema.sql                  # Database schema
├── package.json                # Dependencies
├── .env.example                # Environment template
└── README.md                   # This file
```

## Prerequisites

Before installation, ensure you have:

1. **Node.js 18+** installed
2. **PostgreSQL** installed and running
3. **Redis** installed and running
4. **OpenAI API Key** with access to GPT-5 and DALL-E 3
5. **Facebook Page Access Token** with required permissions

## Installation

### 1. Clone or Download

```bash
cd ~/kangen-autopost
```

### 2. Install Dependencies

```bash
npm install
```

### 3. Set Up PostgreSQL Database

```bash
# Create database
createdb kangen_db

# Run schema
psql kangen_db < schema.sql
```

**Alternative for remote PostgreSQL:**
```bash
psql -h your-host -U your-user -d kangen_db -f schema.sql
```

### 4. Install and Start Redis

**macOS (using Homebrew):**
```bash
brew install redis
brew services start redis
```

**Ubuntu/Debian:**
```bash
sudo apt-get install redis-server
sudo systemctl start redis
```

**Docker:**
```bash
docker run -d -p 6379:6379 redis:latest
```

### 5. Get OpenAI API Key

1. Go to https://platform.openai.com/api-keys
2. Click "Create new secret key"
3. Copy the key (starts with `sk-proj-...`)
4. Save it for the next step

### 6. Get Facebook Page Access Token

#### Step-by-Step Guide:

1. **Go to Facebook Developers**: https://developers.facebook.com/
2. **Create an App** (if you don't have one):
   - Click "Create App"
   - Choose "Business" type
   - Fill in app details
3. **Add Facebook Login Product**
4. **Get User Access Token**:
   - Go to Graph API Explorer: https://developers.facebook.com/tools/explorer/
   - Select your app
   - Click "Generate Access Token"
   - Grant permissions: `pages_manage_posts`, `pages_read_engagement`
5. **Convert to Long-Lived Token**:
   - Go to Access Token Debugger: https://developers.facebook.com/tools/debug/accesstoken/
   - Paste your token
   - Click "Extend Access Token"
6. **Get Page Access Token**:
   - Use Graph API Explorer
   - Request: `GET /me/accounts`
   - Find your page and copy its `access_token`
7. **Get Page ID**:
   - Go to your Facebook page
   - Click "About"
   - Scroll to find Page ID

**Required Permissions:**
- `pages_manage_posts` - To create posts
- `pages_read_engagement` - To read engagement metrics

### 7. Configure Environment

```bash
# Copy example file
cp .env.example .env

# Edit with your values
nano .env
```

**Fill in these values in `.env`:**

```env
OPENAI_API_KEY=sk-proj-your-actual-key-here
FACEBOOK_PAGE_ID=your-page-id-here
FACEBOOK_PAGE_ACCESS_TOKEN=your-page-token-here
DATABASE_URL=postgresql://postgres:password@localhost:5432/kangen_db
REDIS_URL=redis://localhost:6379
NODE_ENV=production
PORT=3000
TZ=Pacific/Honolulu
LOG_LEVEL=info
```

## Usage

### Test the System First

Before running the full system, test that everything works:

```bash
node test-post.js
```

This will:
1. Test database connection
2. Generate content with GPT
3. Generate an image with DALL-E 3
4. Post to Facebook immediately
5. Show the results

**Expected output:**
```
🧪 Kangen Water Facebook Auto-Post - Test Script
[Test] Step 1/5: Testing database connection...
[Test] ✓ Database connected

[Test] Step 2/5: Generating content with GPT...
[Test] ✓ Content generated
...
✅ TEST COMPLETED SUCCESSFULLY!
```

### Run the Application

```bash
npm start
```

The application will:
- Start the Express server on port 3000
- Initialize all workers (content, image, publish)
- Start the scheduler for 6 AM, 12 PM, 6 PM HST
- Display status and queue information

**Expected output:**
```
🌊 Kangen Water Facebook Auto-Post System
[App] Testing connections...
[App] ✓ Database connected
[App] ✓ Redis connected
[App] ✓ OpenAI API connected
[App] ✓ Facebook API connected
[App] 🌐 Express server running on port 3000
[App] 🕐 Starting scheduler...
✅ System is ready and running!
```

### Monitor the System

**Check health:**
```bash
curl http://localhost:3000/health
```

**Check status:**
```bash
curl http://localhost:3000/status
```

## Posting Schedule

Posts are automatically scheduled for:

- **6:00 AM HST** - Morning post
- **12:00 PM HST** - Noon post
- **6:00 PM HST** - Evening post

The system rotates through these 10 topics:

1. Benefits of Alkaline Water
2. Hydration and Wellness
3. pH Balance and Health
4. Kangen Water vs Tap Water
5. Detoxification Through Water
6. Energy and Hydration
7. Skin Health and Alkaline Water
8. Athletic Performance and Hydration
9. Immune System and pH Balance
10. Daily Wellness Routine

## Content Guidelines

All generated content follows these rules:

- **150-200 words** per post
- **Conversational, friendly, educational tone**
- **No medical claims** - frames as "supports wellness" not "cures disease"
- **Includes 3-4 hashtags** (e.g., #KangenWater #AlkalineWater #Wellness)
- **Call-to-action** at the end: "Order yours today!" or "DM for more info"
- **Images** are professional, clean, blue/water themed

## How It Works

### Workflow

1. **Scheduler** triggers at scheduled times (6 AM, 12 PM, 6 PM HST)
2. **Content Worker** generates post text using GPT-5-mini
3. Post is saved to database
4. **Image Worker** generates image using DALL-E 3
5. Database is updated with image URL
6. **Publish Worker** posts to Facebook with content + image
7. Database is updated with Facebook post ID

### Job Queue (BullMQ)

- **Automatic retry** on failure (max 3 attempts, exponential backoff)
- **Dead-letter queue** for permanent failures
- **Rate limiting** to respect API limits
- **Concurrent processing** for efficiency

### Error Handling

- **OpenAI API failures**: Retries with backoff
- **DALL-E failures**: Posts text-only (no image)
- **Facebook API errors**: Retries up to 3 times
- **Token expiration**: Clear error message to regenerate token
- **Database errors**: Logged with full stack trace

## Database Schema

The `kangen_posts` table tracks all posts:

```sql
- id (primary key)
- topic (post topic)
- content (post text)
- hashtags (hashtags)
- image_url (DALL-E generated image)
- facebook_post_id (FB post ID after publishing)
- status (scheduled, generating, posting, posted, failed)
- posted_at (when posted)
- engagement_likes, engagement_comments, engagement_shares
- error_message (if failed)
- retry_count (number of retries)
- created_at, updated_at
```

## Troubleshooting

### Database Connection Failed

**Error**: `Connection failed: ECONNREFUSED`

**Solution**:
```bash
# Check if PostgreSQL is running
pg_isready

# Start PostgreSQL (macOS)
brew services start postgresql

# Start PostgreSQL (Ubuntu)
sudo systemctl start postgresql
```

### Redis Connection Failed

**Error**: `Redis connection error: ECONNREFUSED`

**Solution**:
```bash
# Check if Redis is running
redis-cli ping

# Should return: PONG

# Start Redis (macOS)
brew services start redis

# Start Redis (Ubuntu)
sudo systemctl start redis
```

### OpenAI API Error

**Error**: `Invalid API key` or `Insufficient quota`

**Solution**:
- Check your API key is correct in `.env`
- Verify you have credits: https://platform.openai.com/account/billing
- Ensure key has access to GPT-5 and DALL-E 3

### Facebook API Error

**Error**: `Invalid OAuth 2.0 Access Token`

**Solution**:
- Token may have expired (regenerate following step 6)
- Check permissions: `pages_manage_posts`, `pages_read_engagement`
- Verify page ID is correct

**Error**: `Permissions error`

**Solution**:
- You need `pages_manage_posts` permission
- Regenerate token with correct permissions

### Posts Not Scheduling

**Issue**: Application runs but no posts at scheduled times

**Solution**:
- Check timezone is `Pacific/Honolulu` in `.env`
- Verify cron is running: check logs for `[Scheduler]` messages
- Manually test: `node test-post.js`

### Image Generation Fails

**Issue**: Posts go out without images

**Solution**:
- DALL-E 3 can sometimes fail - this is expected
- System will automatically post text-only
- Check OpenAI status: https://status.openai.com/
- Review DALL-E rate limits

## Maintenance

### View Recent Posts

```bash
psql kangen_db -c "SELECT id, topic, status, posted_at FROM kangen_posts ORDER BY posted_at DESC LIMIT 10;"
```

### Clean Up Old Jobs

Jobs are automatically cleaned:
- Completed jobs: Kept for 24 hours
- Failed jobs: Kept for 7 days

### Update Facebook Token

Long-lived tokens expire after 60 days. When they do:

1. Generate a new token (see step 6)
2. Update `.env` file
3. Restart application: `npm start`

### Monitor Logs

Application logs to console. To save logs:

```bash
npm start > logs.txt 2>&1
```

Or use PM2 for production:

```bash
npm install -g pm2
pm2 start app.js --name kangen-autopost
pm2 logs kangen-autopost
```

## Production Deployment

### Using PM2 (Recommended)

```bash
# Install PM2
npm install -g pm2

# Start application
pm2 start app.js --name kangen-autopost

# Set to start on boot
pm2 startup
pm2 save

# Monitor
pm2 monit

# View logs
pm2 logs kangen-autopost
```

### Using systemd (Linux)

Create `/etc/systemd/system/kangen-autopost.service`:

```ini
[Unit]
Description=Kangen Water Facebook Auto-Post
After=network.target postgresql.service redis.service

[Service]
Type=simple
User=your-user
WorkingDirectory=/path/to/kangen-autopost
ExecStart=/usr/bin/node app.js
Restart=always
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

Then:
```bash
sudo systemctl enable kangen-autopost
sudo systemctl start kangen-autopost
sudo systemctl status kangen-autopost
```

## API Endpoints

- `GET /` - Application info
- `GET /health` - Health check with queue stats
- `GET /status` - Detailed status including Facebook page info

## Cost Estimates

### OpenAI API Costs (per post)

- **GPT-5-mini**: ~$0.001-0.003 per post
- **DALL-E 3**: ~$0.04 per image
- **Total per post**: ~$0.041-0.043
- **Daily (3 posts)**: ~$0.12-0.13
- **Monthly**: ~$3.60-3.90

### Infrastructure

- **PostgreSQL**: Free (self-hosted) or $7-20/month (managed)
- **Redis**: Free (self-hosted) or $5-15/month (managed)
- **Server**: $5-20/month (VPS) or free (local)

## License

MIT

## Support

For issues or questions:
1. Check this README thoroughly
2. Review logs for specific error messages
3. Test individual components with `test-post.js`
4. Check API status pages:
   - OpenAI: https://status.openai.com/
   - Facebook: https://developers.facebook.com/status/

## Target Page

**Facebook Page**: facebook.com/kangenwaterblessedandbeautiful

---

**Built with Node.js, OpenAI, and Facebook Graph API**
