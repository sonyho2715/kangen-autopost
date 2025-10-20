/**
 * Auto-Approval Engine
 * Intelligently approves posts based on confidence scores
 * Learns from user rejections to improve approval thresholds
 */

import pool from './db.js';
import { learnFromApproval } from './engagement-predictor.js';

// Default approval settings
const DEFAULT_SETTINGS = {
  CONFIDENCE_THRESHOLD_AUTO: 85,
  CONFIDENCE_THRESHOLD_MANUAL: 60,
  CONFIDENCE_THRESHOLD_DELAYED: 70,
  DELAYED_APPROVAL_MINUTES: 5,
};

/**
 * Get current approval settings
 */
export async function getApprovalSettings() {
  try {
    const result = await pool.query('SELECT * FROM approval_settings LIMIT 1');

    if (result.rows.length === 0) {
      // Create default settings
      await pool.query(
        `INSERT INTO approval_settings (confidence_threshold_auto, confidence_threshold_manual, confidence_threshold_delayed, delayed_approval_minutes)
         VALUES ($1, $2, $3, $4)`,
        [
          DEFAULT_SETTINGS.CONFIDENCE_THRESHOLD_AUTO,
          DEFAULT_SETTINGS.CONFIDENCE_THRESHOLD_MANUAL,
          DEFAULT_SETTINGS.CONFIDENCE_THRESHOLD_DELAYED,
          DEFAULT_SETTINGS.DELAYED_APPROVAL_MINUTES,
        ]
      );

      return DEFAULT_SETTINGS;
    }

    return {
      CONFIDENCE_THRESHOLD_AUTO: result.rows[0].confidence_threshold_auto,
      CONFIDENCE_THRESHOLD_MANUAL: result.rows[0].confidence_threshold_manual,
      CONFIDENCE_THRESHOLD_DELAYED: result.rows[0].confidence_threshold_delayed,
      DELAYED_APPROVAL_MINUTES: result.rows[0].delayed_approval_minutes,
    };
  } catch (error) {
    console.error('[AutoApprover] Error getting settings:', error);
    return DEFAULT_SETTINGS;
  }
}

/**
 * Update approval settings
 */
export async function updateApprovalSettings(settings) {
  try {
    await pool.query(
      `UPDATE approval_settings
       SET confidence_threshold_auto = $1,
           confidence_threshold_manual = $2,
           confidence_threshold_delayed = $3,
           delayed_approval_minutes = $4,
           updated_at = NOW()`,
      [
        settings.CONFIDENCE_THRESHOLD_AUTO || DEFAULT_SETTINGS.CONFIDENCE_THRESHOLD_AUTO,
        settings.CONFIDENCE_THRESHOLD_MANUAL || DEFAULT_SETTINGS.CONFIDENCE_THRESHOLD_MANUAL,
        settings.CONFIDENCE_THRESHOLD_DELAYED || DEFAULT_SETTINGS.CONFIDENCE_THRESHOLD_DELAYED,
        settings.DELAYED_APPROVAL_MINUTES || DEFAULT_SETTINGS.DELAYED_APPROVAL_MINUTES,
      ]
    );

    console.log('[AutoApprover] Settings updated:', settings);
    return settings;
  } catch (error) {
    console.error('[AutoApprover] Error updating settings:', error);
    throw error;
  }
}

/**
 * Determine approval action based on confidence score
 */
export async function determineApprovalAction(postId, confidenceScore) {
  try {
    const settings = await getApprovalSettings();

    let action = 'manual_review';
    let reason = '';

    if (confidenceScore >= settings.CONFIDENCE_THRESHOLD_AUTO) {
      action = 'auto_approve';
      reason = `High confidence (${confidenceScore} >= ${settings.CONFIDENCE_THRESHOLD_AUTO})`;
    } else if (confidenceScore >= settings.CONFIDENCE_THRESHOLD_DELAYED) {
      action = 'delayed_approve';
      reason = `Medium-high confidence (${confidenceScore} >= ${settings.CONFIDENCE_THRESHOLD_DELAYED})`;
    } else if (confidenceScore >= settings.CONFIDENCE_THRESHOLD_MANUAL) {
      action = 'optional_review';
      reason = `Medium confidence (${confidenceScore} >= ${settings.CONFIDENCE_THRESHOLD_MANUAL})`;
    } else {
      action = 'manual_review';
      reason = `Low confidence (${confidenceScore} < ${settings.CONFIDENCE_THRESHOLD_MANUAL})`;
    }

    console.log(`[AutoApprover] Post ${postId}: ${action} - ${reason}`);

    return {
      postId,
      action,
      reason,
      confidenceScore,
    };
  } catch (error) {
    console.error('[AutoApprover] Error determining action:', error);
    return { postId, action: 'manual_review', reason: 'Error in auto-approval logic' };
  }
}

/**
 * Auto-approve a post and queue it for publishing
 */
export async function autoApprovePost(postId) {
  try {
    console.log('[AutoApprover] Auto-approving post:', postId);

    await pool.query(
      `UPDATE kangen_posts
       SET status = 'posting', approval_method = 'auto'
       WHERE id = $1`,
      [postId]
    );

    // Queue for publishing (import from queue.js)
    const { addPublishJob } = await import('./queue.js');
    await addPublishJob(postId);

    console.log('[AutoApprover] Post queued for publishing');
    return { success: true, action: 'auto_approve' };
  } catch (error) {
    console.error('[AutoApprover] Error auto-approving post:', error);
    throw error;
  }
}

/**
 * Schedule delayed approval (approve after N minutes)
 */
export async function scheduleDelayedApproval(postId, delayMinutes) {
  try {
    console.log(`[AutoApprover] Scheduling delayed approval for post ${postId} in ${delayMinutes} minutes`);

    const approvalTime = new Date(Date.now() + delayMinutes * 60 * 1000);

    // Store the scheduled time
    await pool.query(
      `UPDATE kangen_posts
       SET approval_method = 'delayed', scheduled_approval_at = $1
       WHERE id = $2`,
      [approvalTime, postId]
    );

    // Set timeout to approve
    setTimeout(async () => {
      try {
        const result = await pool.query('SELECT status FROM kangen_posts WHERE id = $1', [postId]);

        if (result.rows[0].status === 'scheduled') {
          // User hasn't manually rejected, so auto-approve
          await autoApprovePost(postId);
          console.log(`[AutoApprover] Delayed approval executed for post ${postId}`);
        }
      } catch (err) {
        console.error('[AutoApprover] Error executing delayed approval:', err);
      }
    }, delayMinutes * 60 * 1000);

    return { success: true, approvalTime };
  } catch (error) {
    console.error('[AutoApprover] Error scheduling delayed approval:', error);
    throw error;
  }
}

/**
 * User rejects a post - learn from this
 */
export async function rejectPost(postId, reason) {
  try {
    console.log(`[AutoApprover] Post rejected: ${postId} - Reason: ${reason}`);

    const postResult = await pool.query(
      `SELECT confidence_score, engagement_rate FROM kangen_posts WHERE id = $1`,
      [postId]
    );

    if (postResult.rows.length === 0) {
      throw new Error('Post not found');
    }

    const post = postResult.rows[0];

    // Update post status
    await pool.query(
      `UPDATE kangen_posts
       SET status = 'rejected', approval_method = 'manual_reject'
       WHERE id = $1`,
      [postId]
    );

    // Learn: User rejected this even though it had high confidence?
    // Lower future thresholds if this pattern emerges
    if (post.confidence_score >= 70) {
      console.log('[AutoApprover] User rejected high-confidence post - may need to adjust thresholds');
      await recordRejection(postId, post.confidence_score, reason);
    }

    return { success: true, action: 'rejected' };
  } catch (error) {
    console.error('[AutoApprover] Error rejecting post:', error);
    throw error;
  }
}

/**
 * User approves a post - learn this worked well
 */
export async function userApprovePost(postId) {
  try {
    console.log('[AutoApprover] User approved post:', postId);

    await pool.query(
      `UPDATE kangen_posts
       SET status = 'posting', approval_method = 'manual_approve'
       WHERE id = $1`,
      [postId]
    );

    // Queue for publishing
    const { addPublishJob } = await import('./queue.js');
    await addPublishJob(postId);

    return { success: true, action: 'approved' };
  } catch (error) {
    console.error('[AutoApprover] Error approving post:', error);
    throw error;
  }
}

/**
 * Record rejection for learning
 */
async function recordRejection(postId, confidenceScore, reason) {
  try {
    await pool.query(
      `INSERT INTO approval_history (post_id, user_rating, predicted_score)
       VALUES ($1, $2, $3)`,
      [postId, -1, confidenceScore] // -1 indicates rejection
    );
  } catch (error) {
    console.error('[AutoApprover] Error recording rejection:', error);
  }
}

/**
 * Get approval statistics
 */
export async function getApprovalStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(CASE WHEN approval_method = 'auto' THEN 1 END) as auto_approved,
        COUNT(CASE WHEN approval_method = 'manual_approve' THEN 1 END) as manually_approved,
        COUNT(CASE WHEN approval_method = 'delayed' THEN 1 END) as delayed_approved,
        COUNT(CASE WHEN status = 'rejected' THEN 1 END) as rejected,
        COUNT(CASE WHEN approval_method = 'manual' AND status = 'scheduled' THEN 1 END) as pending_review
      FROM kangen_posts
      WHERE posted_at > NOW() - INTERVAL '30 days'
    `);

    const stats = result.rows[0];
    const total =
      stats.auto_approved +
      stats.manually_approved +
      stats.delayed_approved +
      stats.rejected +
      stats.pending_review;

    return {
      total,
      autoApproved: stats.auto_approved,
      autoApprovedPercent: total > 0 ? `${((stats.auto_approved / total) * 100).toFixed(1)}%` : '0%',
      manuallyApproved: stats.manually_approved,
      delayedApproved: stats.delayed_approved,
      rejected: stats.rejected,
      pendingReview: stats.pending_review,
    };
  } catch (error) {
    console.error('[AutoApprover] Error getting stats:', error);
    throw error;
  }
}

/**
 * Get posts awaiting manual review
 */
export async function getPendingReview(limit = 10) {
  try {
    const result = await pool.query(
      `SELECT id, topic, content, confidence_score, created_at, image_url
       FROM kangen_posts
       WHERE status = 'scheduled' AND approval_method = 'manual'
       ORDER BY confidence_score ASC, created_at DESC
       LIMIT $1`,
      [limit]
    );

    return result.rows;
  } catch (error) {
    console.error('[AutoApprover] Error fetching pending reviews:', error);
    throw error;
  }
}
