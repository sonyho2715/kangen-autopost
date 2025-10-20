/**
 * A/B Test Generator
 * Creates 3 variants of posts with different hooks, CTAs, and messaging
 * Allows users to select best variant or auto-pick based on prediction
 */

import pool from './db.js';
import { generateContent } from './openai-generator.js';
import { predictEngagement } from './engagement-predictor.js';

const VARIANT_CONFIGS = {
  A: {
    name: 'Question Hook',
    hook: 'Start with a question',
    cta: 'Learn More',
    description: 'Curiosity-driven, asks user to think',
  },
  B: {
    name: 'Value Hook',
    hook: 'Lead with immediate value/benefit',
    cta: 'Try Now',
    description: 'Direct benefit statement',
  },
  C: {
    name: 'Story Hook',
    hook: 'Begin with a compelling scenario',
    cta: 'Join Us',
    description: 'Narrative-driven, relatable story',
  },
};

/**
 * Generate A/B test variants for a topic
 */
export async function generateABTestVariants(topic) {
  try {
    console.log('[ABTester] Generating 3 variants for topic:', topic);

    const variants = {};

    // Generate each variant with different prompt modifications
    for (const [variantKey, config] of Object.entries(VARIANT_CONFIGS)) {
      try {
        console.log(`[ABTester] Generating variant ${variantKey}: ${config.name}`);

        const customPrompt = `
Write a compelling social media post about "${topic}" related to Kangen water.
${config.hook}
Call-to-action: ${config.cta}
Focus on benefits and engagement.
Keep it between 150-250 characters.
`;

        // Modify the content generator to accept custom prompts
        const result = await generateContent(topic, { customPrompt });

        const prediction = await predictEngagement(topic, result.content, result.hashtags, new Date());

        variants[variantKey] = {
          variant: variantKey,
          name: config.name,
          description: config.description,
          hook: config.hook,
          cta: config.cta,
          content: result.content,
          hashtags: result.hashtags,
          tokensUsed: result.tokensUsed,
          predictedScore: prediction.confidenceScore,
          predictionFactors: prediction.factors,
        };

        console.log(`[ABTester] Variant ${variantKey} created - Score: ${prediction.confidenceScore}`);
      } catch (error) {
        console.error(`[ABTester] Error generating variant ${variantKey}:`, error);
        variants[variantKey] = {
          variant: variantKey,
          error: error.message,
        };
      }
    }

    // Sort by predicted score
    const sortedVariants = Object.values(variants)
      .filter((v) => !v.error)
      .sort((a, b) => b.predictedScore - a.predictedScore);

    const result = {
      topic,
      variants: sortedVariants,
      bestVariant: sortedVariants[0],
      recommendation: getVariantRecommendation(sortedVariants),
      generatedAt: new Date(),
    };

    console.log('[ABTester] A/B test generated:', {
      topic,
      variantCount: sortedVariants.length,
      bestPredicted: sortedVariants[0]?.predictedScore,
    });

    return result;
  } catch (error) {
    console.error('[ABTester] Error generating A/B variants:', error);
    throw error;
  }
}

/**
 * Get recommendation text for variants
 */
function getVariantRecommendation(variants) {
  if (variants.length === 0) return 'No variants generated successfully';

  const best = variants[0];
  const second = variants[1];

  if (!second) {
    return `Variant ${best.variant} recommended (${best.predictedScore}/100)`;
  }

  const diff = best.predictedScore - second.predictedScore;

  if (diff > 20) {
    return `${best.variant} strongly recommended over ${second.variant} (+${diff} points)`;
  } else if (diff > 5) {
    return `${best.variant} slightly favored over ${second.variant} (+${diff} points)`;
  } else {
    return `${best.variant} and ${second.variant} are close - choose based on preference`;
  }
}

/**
 * Store A/B test variants in database
 */
export async function storeABTestVariants(postId, variants) {
  try {
    console.log('[ABTester] Storing A/B test variants for post:', postId);

    const variantA = variants[0] || {};
    const variantB = variants[1] || {};
    const variantC = variants[2] || {};

    await pool.query(
      `INSERT INTO post_variants (post_id, variant_a_content, variant_a_hook, variant_a_cta, variant_a_predicted,
                                   variant_b_content, variant_b_hook, variant_b_cta, variant_b_predicted,
                                   variant_c_content, variant_c_hook, variant_c_cta, variant_c_predicted)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
      [
        postId,
        variantA.content,
        variantA.hook,
        variantA.cta,
        variantA.predictedScore,
        variantB.content,
        variantB.hook,
        variantB.cta,
        variantB.predictedScore,
        variantC.content,
        variantC.hook,
        variantC.cta,
        variantC.predictedScore,
      ]
    );

    console.log('[ABTester] A/B test variants stored');
  } catch (error) {
    console.error('[ABTester] Error storing variants:', error);
    throw error;
  }
}

/**
 * User selects a variant - record selection and use that content
 */
export async function selectVariant(postId, variantKey) {
  try {
    console.log(`[ABTester] User selected variant ${variantKey} for post ${postId}`);

    const result = await pool.query(
      `SELECT variant_${variantKey.toLowerCase()}_content,
              variant_${variantKey.toLowerCase()}_hook,
              variant_${variantKey.toLowerCase()}_cta
       FROM post_variants
       WHERE post_id = $1`,
      [postId]
    );

    if (result.rows.length === 0) {
      throw new Error('Variants not found for post');
    }

    const variant = result.rows[0];
    const content = variant[`variant_${variantKey.toLowerCase()}_content`];

    // Update posts table to use selected variant
    await pool.query(
      `UPDATE kangen_posts SET content = $1, variant_id = $2 WHERE id = $3`,
      [content, variantKey, postId]
    );

    // Mark which variant was selected
    await pool.query(
      `UPDATE post_variants SET selected_variant = $1 WHERE post_id = $2`,
      [variantKey, postId]
    );

    console.log(`[ABTester] Variant ${variantKey} selected and applied to post`);

    return {
      postId,
      selectedVariant: variantKey,
      content,
    };
  } catch (error) {
    console.error('[ABTester] Error selecting variant:', error);
    throw error;
  }
}

/**
 * Get A/B test results for a post
 */
export async function getABTestResults(postId) {
  try {
    const result = await pool.query(
      `SELECT
         selected_variant,
         variant_a_content, variant_a_hook, variant_a_predicted,
         variant_b_content, variant_b_hook, variant_b_predicted,
         variant_c_content, variant_c_hook, variant_c_predicted
       FROM post_variants
       WHERE post_id = $1`,
      [postId]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0];

    return {
      postId,
      selectedVariant: row.selected_variant,
      variants: [
        {
          variant: 'A',
          content: row.variant_a_content,
          hook: row.variant_a_hook,
          predictedScore: row.variant_a_predicted,
          selected: row.selected_variant === 'A',
        },
        {
          variant: 'B',
          content: row.variant_b_content,
          hook: row.variant_b_hook,
          predictedScore: row.variant_b_predicted,
          selected: row.selected_variant === 'B',
        },
        {
          variant: 'C',
          content: row.variant_c_content,
          hook: row.variant_c_hook,
          predictedScore: row.variant_c_predicted,
          selected: row.selected_variant === 'C',
        },
      ],
    };
  } catch (error) {
    console.error('[ABTester] Error getting test results:', error);
    throw error;
  }
}

/**
 * Compare variant performance after posts are published
 */
export async function compareVariantPerformance(days = 7) {
  try {
    const result = await pool.query(
      `SELECT
         pv.selected_variant,
         COUNT(pv.id) as uses,
         AVG(kp.engagement_rate) as avg_engagement,
         MAX(kp.engagement_rate) as max_engagement,
         MIN(kp.engagement_rate) as min_engagement
       FROM post_variants pv
       JOIN kangen_posts kp ON pv.post_id = kp.id
       WHERE kp.status = 'posted'
       AND kp.posted_at > NOW() - INTERVAL '$1 days'
       GROUP BY pv.selected_variant
       ORDER BY avg_engagement DESC`,
      [days]
    );

    return result.rows.map((row) => ({
      variant: row.selected_variant,
      timesUsed: row.uses,
      avgEngagement: parseFloat(row.avg_engagement).toFixed(2),
      maxEngagement: parseFloat(row.max_engagement).toFixed(2),
      minEngagement: parseFloat(row.min_engagement).toFixed(2),
    }));
  } catch (error) {
    console.error('[ABTester] Error comparing performance:', error);
    throw error;
  }
}

/**
 * Get A/B test statistics
 */
export async function getABTestStats() {
  try {
    const result = await pool.query(`
      SELECT
        COUNT(*) as total_tests,
        COUNT(CASE WHEN selected_variant = 'A' THEN 1 END) as variant_a_count,
        COUNT(CASE WHEN selected_variant = 'B' THEN 1 END) as variant_b_count,
        COUNT(CASE WHEN selected_variant = 'C' THEN 1 END) as variant_c_count
      FROM post_variants
      WHERE selected_variant IS NOT NULL
    `);

    const stats = result.rows[0];
    return {
      totalTests: stats.total_tests,
      variantAPercent: stats.total_tests > 0 ? `${((stats.variant_a_count / stats.total_tests) * 100).toFixed(1)}%` : '0%',
      variantBPercent: stats.total_tests > 0 ? `${((stats.variant_b_count / stats.total_tests) * 100).toFixed(1)}%` : '0%',
      variantCPercent: stats.total_tests > 0 ? `${((stats.variant_c_count / stats.total_tests) * 100).toFixed(1)}%` : '0%',
    };
  } catch (error) {
    console.error('[ABTester] Error getting stats:', error);
    throw error;
  }
}
