/**
 * Facebook Graph API Poster
 * Handles posting content to Facebook pages using Graph API v18.0
 */

import fetch, { FormData, Blob } from 'node-fetch';
import dotenv from 'dotenv';

dotenv.config();

const FACEBOOK_API_VERSION = 'v18.0';
const GRAPH_API_BASE = `https://graph.facebook.com/${FACEBOOK_API_VERSION}`;

const pageId = process.env.FACEBOOK_PAGE_ID;
const pageAccessToken = process.env.FACEBOOK_PAGE_ACCESS_TOKEN;

/**
 * Post text and image to Facebook page
 */
export async function postToFacebook({ message, imageUrl, hashtags }) {
  try {
    console.log('[Facebook] Preparing to post to Facebook');

    // Combine message and hashtags
    const fullMessage = `${message}\n\n${hashtags}`;

    let postId;

    if (imageUrl) {
      // Post with image (photo post)
      postId = await postPhoto(fullMessage, imageUrl);
    } else {
      // Post text only
      postId = await postText(fullMessage);
    }

    console.log(`[Facebook] Successfully posted to Facebook. Post ID: ${postId}`);
    return postId;
  } catch (error) {
    console.error('[Facebook] Error posting to Facebook:', error.message);
    throw error;
  }
}

/**
 * Post photo to Facebook page
 * Downloads image and uploads to Facebook
 */
async function postPhoto(message, imageUrl) {
  try {
    // Download the image from DALL-E URL
    console.log('[Facebook] Downloading image from DALL-E...');
    const imageResponse = await fetch(imageUrl);
    const imageBuffer = await imageResponse.arrayBuffer();
    const imageBlob = new Blob([imageBuffer], { type: 'image/png' });

    // Upload to Facebook using multipart/form-data
    const url = `${GRAPH_API_BASE}/${pageId}/photos`;

    const formData = new FormData();
    formData.append('source', imageBlob, 'image.png');
    formData.append('caption', message);
    formData.append('access_token', pageAccessToken);
    formData.append('published', 'true');

    const response = await fetch(url, {
      method: 'POST',
      body: formData,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${data.error?.message || 'Unknown error'}`);
    }

    console.log('[Facebook] Photo posted successfully');
    return data.id;
  } catch (error) {
    console.error('[Facebook] Error posting photo:', error.message);
    throw error;
  }
}

/**
 * Post text-only to Facebook page
 */
async function postText(message) {
  try {
    const url = `${GRAPH_API_BASE}/${pageId}/feed`;

    const params = new URLSearchParams({
      message: message,
      access_token: pageAccessToken,
    });

    const response = await fetch(url, {
      method: 'POST',
      body: params,
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${data.error?.message || 'Unknown error'}`);
    }

    console.log('[Facebook] Text post created successfully');
    return data.id;
  } catch (error) {
    console.error('[Facebook] Error posting text:', error.message);
    throw error;
  }
}

/**
 * Get engagement metrics for a post
 */
export async function getPostEngagement(postId) {
  try {
    const url = `${GRAPH_API_BASE}/${postId}`;

    const params = new URLSearchParams({
      fields: 'likes.summary(true),comments.summary(true),shares',
      access_token: pageAccessToken,
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${data.error?.message || 'Unknown error'}`);
    }

    return {
      likes: data.likes?.summary?.total_count || 0,
      comments: data.comments?.summary?.total_count || 0,
      shares: data.shares?.count || 0,
    };
  } catch (error) {
    console.error('[Facebook] Error fetching engagement:', error.message);
    return { likes: 0, comments: 0, shares: 0 };
  }
}

/**
 * Test Facebook API connection and token validity
 */
export async function testConnection() {
  try {
    console.log('[Facebook] Testing API connection...');

    const url = `${GRAPH_API_BASE}/${pageId}`;
    const params = new URLSearchParams({
      fields: 'id,name,access_token',
      access_token: pageAccessToken,
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${data.error?.message || 'Unknown error'}`);
    }

    console.log(`[Facebook] Connection successful. Page: ${data.name} (ID: ${data.id})`);
    return true;
  } catch (error) {
    console.error('[Facebook] Connection test failed:', error.message);

    // Check for specific error types
    if (error.message.includes('Invalid OAuth')) {
      console.error('[Facebook] Token is invalid or expired. Please generate a new token.');
    } else if (error.message.includes('permissions')) {
      console.error('[Facebook] Token lacks required permissions. Need: pages_manage_posts, pages_read_engagement');
    }

    return false;
  }
}

/**
 * Validate page access token
 */
export async function validateToken() {
  try {
    const url = `${GRAPH_API_BASE}/me`;
    const params = new URLSearchParams({
      access_token: pageAccessToken,
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();

    if (!response.ok) {
      console.error('[Facebook] Token validation failed:', data.error?.message);
      return false;
    }

    console.log('[Facebook] Token is valid');
    return true;
  } catch (error) {
    console.error('[Facebook] Token validation error:', error.message);
    return false;
  }
}

/**
 * Delete a post (for testing purposes)
 */
export async function deletePost(postId) {
  try {
    const url = `${GRAPH_API_BASE}/${postId}`;
    const params = new URLSearchParams({
      access_token: pageAccessToken,
    });

    const response = await fetch(`${url}?${params}`, {
      method: 'DELETE',
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${data.error?.message || 'Unknown error'}`);
    }

    console.log(`[Facebook] Post ${postId} deleted successfully`);
    return true;
  } catch (error) {
    console.error('[Facebook] Error deleting post:', error.message);
    return false;
  }
}

/**
 * Get page info
 */
export async function getPageInfo() {
  try {
    const url = `${GRAPH_API_BASE}/${pageId}`;
    const params = new URLSearchParams({
      fields: 'id,name,fan_count,followers_count,category',
      access_token: pageAccessToken,
    });

    const response = await fetch(`${url}?${params}`);
    const data = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${data.error?.message || 'Unknown error'}`);
    }

    return data;
  } catch (error) {
    console.error('[Facebook] Error fetching page info:', error.message);
    return null;
  }
}

export default {
  postToFacebook,
  getPostEngagement,
  testConnection,
  validateToken,
  deletePost,
  getPageInfo,
};
