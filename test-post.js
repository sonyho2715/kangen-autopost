/**
 * Manual Test Script
 * Tests the complete posting workflow without waiting for scheduled times
 *
 * Usage: node test-post.js
 */

import dotenv from 'dotenv';
import { generateContent, generateImage } from './lib/openai-generator.js';
import { postToFacebook } from './lib/facebook-poster.js';
import { createPost, markPostAsPosted, updatePostImage, testConnection as testDB } from './lib/db.js';

dotenv.config();

// Test topic
const TEST_TOPIC = 'Benefits of Alkaline Water';

console.log('\n' + '='.repeat(70));
console.log('🧪 Kangen Water Facebook Auto-Post - Test Script');
console.log('='.repeat(70));
console.log(`Test Topic: ${TEST_TOPIC}`);
console.log('='.repeat(70) + '\n');

async function runTest() {
  try {
    // Step 1: Test Database Connection
    console.log('[Test] Step 1/5: Testing database connection...');
    await testDB();
    console.log('[Test] ✓ Database connected\n');

    // Step 2: Generate Content
    console.log('[Test] Step 2/5: Generating content with GPT...');
    const { content, hashtags, tokensUsed } = await generateContent(TEST_TOPIC);
    console.log('[Test] ✓ Content generated');
    console.log(`[Test] Tokens used: ${tokensUsed}`);
    console.log(`[Test] Content preview:\n${content.substring(0, 150)}...\n`);
    console.log(`[Test] Hashtags: ${hashtags}\n`);

    // Step 3: Save to Database
    console.log('[Test] Step 3/5: Saving post to database...');
    const post = await createPost({
      topic: TEST_TOPIC,
      content,
      hashtags,
      imageUrl: null,
    });
    console.log(`[Test] ✓ Post saved with ID: ${post.id}\n`);

    // Step 4: Generate Image
    console.log('[Test] Step 4/5: Generating image with DALL-E 3...');
    console.log('[Test] (This may take 15-30 seconds...)');
    const imageResult = await generateImage(TEST_TOPIC, content);

    let imageUrl = null;
    if (imageResult && imageResult.imageUrl) {
      imageUrl = imageResult.imageUrl;
      console.log('[Test] ✓ Image generated successfully');
      console.log(`[Test] Image URL: ${imageUrl}\n`);

      // Update database with image URL
      await updatePostImage(post.id, imageUrl);
      console.log('[Test] ✓ Database updated with image URL\n');
    } else {
      console.log('[Test] ⚠️  Image generation failed, will post text-only\n');
    }

    // Step 5: Post to Facebook
    console.log('[Test] Step 5/5: Posting to Facebook...');
    const facebookPostId = await postToFacebook({
      message: content,
      imageUrl: imageUrl,
      hashtags: hashtags,
    });

    console.log('[Test] ✓ Successfully posted to Facebook!');
    console.log(`[Test] Facebook Post ID: ${facebookPostId}\n`);

    // Update database
    await markPostAsPosted(post.id, facebookPostId);
    console.log('[Test] ✓ Database updated with Facebook post ID\n');

    // Success summary
    console.log('='.repeat(70));
    console.log('✅ TEST COMPLETED SUCCESSFULLY!');
    console.log('='.repeat(70));
    console.log('Summary:');
    console.log(`  • Database Post ID: ${post.id}`);
    console.log(`  • Facebook Post ID: ${facebookPostId}`);
    console.log(`  • Has Image: ${imageUrl ? 'Yes' : 'No'}`);
    console.log(`  • Content Length: ${content.length} characters`);
    console.log(`  • Topic: ${TEST_TOPIC}`);
    console.log('='.repeat(70));
    console.log('\nCheck your Facebook page to see the post!');
    console.log('Page: facebook.com/kangenwaterblessedandbeautiful\n');

    process.exit(0);
  } catch (error) {
    console.error('\n' + '='.repeat(70));
    console.error('❌ TEST FAILED');
    console.error('='.repeat(70));
    console.error(`Error: ${error.message}`);
    console.error('\nDetails:');
    console.error(error);
    console.error('\nTroubleshooting:');
    console.error('  1. Check your .env file has all required variables');
    console.error('  2. Verify OpenAI API key is valid');
    console.error('  3. Verify Facebook page access token is valid');
    console.error('  4. Check database connection');
    console.error('  5. Ensure you have internet connection\n');
    process.exit(1);
  }
}

// Run the test
runTest();
