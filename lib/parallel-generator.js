/**
 * Parallel Content & Image Generator
 * Generates both content and images simultaneously for faster production
 * Falls back to content-only if image generation fails
 */

import { generateContent, generateImage } from './openai-generator.js';
import pool from './db.js';

export async function generateContentAndImageParallel(topic) {
  const startTime = Date.now();

  try {
    console.log('[ParallelGen] Starting parallel generation for topic:', topic);

    // Fire both jobs simultaneously instead of sequential
    const [contentResult, imageResult] = await Promise.allSettled([
      generateContent(topic),
      generateImage(topic),
    ]);

    const generatedAt = new Date();
    const imageGeneratedAt = new Date();

    // Handle content result
    let content, hashtags, contentTokens;
    if (contentResult.status === 'fulfilled') {
      content = contentResult.value.content;
      hashtags = contentResult.value.hashtags;
      contentTokens = contentResult.value.tokensUsed;
      console.log('[ParallelGen] Content generated successfully');
    } else {
      console.error('[ParallelGen] Content generation failed:', contentResult.reason);
      throw new Error(`Content generation failed: ${contentResult.reason.message}`);
    }

    // Handle image result
    let imageUrl, imageTokens, imageFailed;
    if (imageResult.status === 'fulfilled') {
      imageUrl = imageResult.value;
      imageTokens = imageResult.value.tokens || 0;
      imageFailed = false;
      console.log('[ParallelGen] Image generated successfully');
    } else {
      console.warn('[ParallelGen] Image generation failed, continuing with text-only:', imageResult.reason);
      imageUrl = null;
      imageFailed = true;
      imageTokens = 0;
    }

    const generationTime = Date.now() - startTime;

    return {
      success: true,
      content,
      hashtags,
      imageUrl,
      imageFailed,
      generatedAt,
      imageGeneratedAt,
      generationTime,
      tokens: {
        content: contentTokens,
        image: imageTokens,
      },
    };
  } catch (error) {
    console.error('[ParallelGen] Parallel generation failed:', error);
    throw error;
  }
}

/**
 * Generate multiple variants in parallel for A/B testing
 * Creates 3 different angles simultaneously
 */
export async function generateVariantsParallel(topic) {
  console.log('[ParallelGen] Generating 3 variants for topic:', topic);

  const hooks = [
    `A question about ${topic}`,
    `A statement about ${topic}`,
    `A curiosity gap about ${topic}`,
  ];

  const ctas = ['Learn More', 'Try Now', 'Discover'];

  try {
    const variants = await Promise.all(
      hooks.map((hook, idx) =>
        generateContent(topic, { customHook: hook })
          .then((result) => ({
            variant: String.fromCharCode(65 + idx), // A, B, C
            hook,
            cta: ctas[idx],
            content: result.content,
            hashtags: result.hashtags,
            tokensUsed: result.tokensUsed,
          }))
          .catch((err) => {
            console.warn(`[ParallelGen] Variant ${String.fromCharCode(65 + idx)} failed:`, err);
            return null;
          })
      )
    );

    const successfulVariants = variants.filter((v) => v !== null);

    console.log(`[ParallelGen] Generated ${successfulVariants.length}/3 variants successfully`);

    return {
      success: true,
      variants: successfulVariants,
      totalTokensUsed: successfulVariants.reduce((sum, v) => sum + v.tokensUsed, 0),
    };
  } catch (error) {
    console.error('[ParallelGen] Variant generation failed:', error);
    throw error;
  }
}

/**
 * Estimate total generation time (useful for progress bars)
 */
export function estimateGenerationTime() {
  // Based on typical parallel generation times
  return {
    contentAndImage: 15000, // 15 seconds for both in parallel
    variantsOnly: 12000, // 12 seconds for 3 variants
    expectedRange: '12-18 seconds',
  };
}
