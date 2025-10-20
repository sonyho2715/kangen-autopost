/**
 * OpenAI Content and Image Generator
 * Uses GPT for text content and DALL-E 3 for image generation
 */

import OpenAI from 'openai';
import dotenv from 'dotenv';

dotenv.config();

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

// Topic-specific prompts for Kangen Water
const topicPrompts = {
  'Benefits of Alkaline Water': 'Create an engaging social media post about the benefits of alkaline water from Kangen systems. Focus on wellness, pH balance, and daily health improvements.',
  'Hydration and Wellness': 'Write about the importance of proper hydration and how Kangen water supports overall wellness. Include practical tips.',
  'pH Balance and Health': 'Explain how pH balance affects health and how alkaline water from Kangen can support a balanced pH level in the body.',
  'Kangen Water vs Tap Water': 'Compare Kangen water with regular tap water, highlighting the differences in quality, pH, and health benefits.',
  'Detoxification Through Water': 'Discuss how proper hydration with alkaline water can support the body\'s natural detoxification processes.',
  'Energy and Hydration': 'Write about the connection between proper hydration with Kangen water and sustained energy levels throughout the day.',
  'Skin Health and Alkaline Water': 'Explain how alkaline water can support healthy, glowing skin and overall appearance.',
  'Athletic Performance and Hydration': 'Discuss how athletes and active individuals can benefit from Kangen water for performance and recovery.',
  'Immune System and pH Balance': 'Write about how maintaining proper pH balance through alkaline water can support immune system health.',
  'Daily Wellness Routine': 'Share tips for incorporating Kangen water into a daily wellness routine for optimal health benefits.',
};

// System prompt for content generation (with prompt caching)
const systemPrompt = `You are a health and wellness content creator specializing in Kangen water education.

IMPORTANT GUIDELINES:
- Write 150-200 words
- Use a conversational, friendly, educational tone
- Be informative but not overly promotional
- Include specific health benefits but NO medical claims
- Frame benefits as "supports wellness" not "cures disease"
- Include relatable examples or statistics when relevant
- End with a call-to-action: "Order yours today!" or "DM for more info"
- Include 3-4 relevant hashtags at the end (e.g., #KangenWater #AlkalineWater #Wellness #HealthyLiving)
- Write in a natural, flowing style that engages readers

DO NOT make medical claims or promise to cure diseases.
DO focus on wellness, lifestyle, and general health support.

Write the post content first, then add the hashtags on the last line.`;

/**
 * Generate content for a specific topic using GPT
 */
export async function generateContent(topic) {
  try {
    console.log(`[OpenAI] Generating content for topic: ${topic}`);

    const topicPrompt = topicPrompts[topic] || `Write an engaging social media post about ${topic} related to Kangen water.`;

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // Using GPT-5-mini as specified
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: topicPrompt,
        },
      ],
      max_completion_tokens: 500,
    });

    const responseText = completion.choices[0].message.content;
    console.log('[OpenAI] Raw response:', responseText);

    // Try to parse JSON, if it fails, extract content and hashtags manually
    let parsedContent, parsedHashtags;
    try {
      const parsedResponse = JSON.parse(responseText);
      parsedContent = parsedResponse.content;
      parsedHashtags = parsedResponse.hashtags;
    } catch (jsonError) {
      // If not JSON, treat entire response as content and extract hashtags
      const lines = responseText.trim().split('\n');
      const lastLine = lines[lines.length - 1];

      if (lastLine.startsWith('#')) {
        parsedHashtags = lastLine;
        parsedContent = lines.slice(0, -1).join('\n').trim();
      } else {
        parsedContent = responseText;
        parsedHashtags = '#KangenWater #AlkalineWater #Wellness #HealthyLiving';
      }
    }

    console.log('[OpenAI] Content generated successfully');
    console.log(`[OpenAI] Tokens used: ${completion.usage.total_tokens}`);

    return {
      content: parsedContent,
      hashtags: parsedHashtags,
      tokensUsed: completion.usage.total_tokens,
    };
  } catch (error) {
    console.error('[OpenAI] Error generating content:', error.message);
    throw error;
  }
}

/**
 * Generate image using DALL-E 3
 */
export async function generateImage(topic, content) {
  try {
    console.log(`[OpenAI] Generating image for topic: ${topic}`);

    // Create a focused image prompt based on the topic
    const imagePrompt = createImagePrompt(topic);

    const response = await openai.images.generate({
      model: 'dall-e-3',
      prompt: imagePrompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    });

    const imageUrl = response.data[0].url;
    console.log('[OpenAI] Image generated successfully');
    console.log(`[OpenAI] Image URL: ${imageUrl}`);

    return {
      imageUrl,
      revisedPrompt: response.data[0].revised_prompt,
    };
  } catch (error) {
    console.error('[OpenAI] Error generating image:', error.message);

    // Return null instead of throwing - allows posting without image
    if (error.response?.status === 400 || error.response?.status === 429) {
      console.log('[OpenAI] Image generation failed, will post text-only');
      return null;
    }

    throw error;
  }
}

/**
 * Create DALL-E prompt based on topic
 */
function createImagePrompt(topic) {
  const baseStyle = 'Professional, clean, modern photography. Beautiful composition with soft natural lighting. Blue and aqua color palette. Wellness and health theme. High quality, Instagram-worthy aesthetic.';

  const topicImagePrompts = {
    'Benefits of Alkaline Water': `A crystal clear glass of pure water with fresh cucumbers and mint leaves on a clean white surface. Water droplets visible. ${baseStyle}`,
    'Hydration and Wellness': `A happy, healthy person drinking water from a glass bottle outdoors in nature, sunlight streaming through trees. Vibrant and fresh. ${baseStyle}`,
    'pH Balance and Health': `Abstract visualization of water molecules and pH balance, with blue and turquoise tones. Clean, scientific yet beautiful. ${baseStyle}`,
    'Kangen Water vs Tap Water': `Two glasses of water side by side on a marble countertop, one sparkling clean and pristine, the other ordinary. ${baseStyle}`,
    'Detoxification Through Water': `Fresh water being poured into a glass surrounded by fresh fruits and vegetables. Clean eating and wellness concept. ${baseStyle}`,
    'Energy and Hydration': `Athletic person in activewear drinking water after exercise, energetic and vibrant setting. Morning sunlight. ${baseStyle}`,
    'Skin Health and Alkaline Water': `Close-up of water droplets on glowing, healthy skin. Fresh and radiant. Spa-like atmosphere. ${baseStyle}`,
    'Athletic Performance and Hydration': `Fit athlete drinking water, gym or outdoor fitness setting. Dynamic and energetic. ${baseStyle}`,
    'Immune System and pH Balance': `Conceptual image of wellness - water glass surrounded by immune-boosting foods like citrus, berries, greens. ${baseStyle}`,
    'Daily Wellness Routine': `Morning wellness routine scene: water glass, journal, plants, natural light streaming through window. Peaceful and inspiring. ${baseStyle}`,
  };

  return topicImagePrompts[topic] || `Beautiful, professional image related to ${topic} and water wellness. ${baseStyle}`;
}

/**
 * Test OpenAI connection
 */
export async function testConnection() {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: 'Say "Hello"' }],
      max_completion_tokens: 10,
    });

    console.log('[OpenAI] Connection test successful');
    return true;
  } catch (error) {
    console.error('[OpenAI] Connection test failed:', error.message);
    return false;
  }
}

export default {
  generateContent,
  generateImage,
  testConnection,
};
