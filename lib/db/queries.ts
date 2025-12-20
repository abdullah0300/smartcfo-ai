import "server-only";

import { supabase } from "../supabase/client";
import type { VisibilityType } from "@/components/visibility-selector";
import { ChatSDKError } from "../errors";
import type { AppUsage } from "../usage";

// Types matching SmartCFO schema
export interface User {
  id: string;
  email: string;
  full_name?: string;
  company_name?: string;
}

export interface Chat {
  id: string;
  user_id: string;
  messages: any[];
  current_context: any;
  status: "active" | "completed" | "cancelled";
  created_at: string;
  updated_at: string;
  // Virtual fields for compatibility with template
  title?: string;
  visibility?: VisibilityType;
  lastContext?: AppUsage | null;
}

export interface DBMessage {
  id: string;
  chatId: string;
  role: string;
  parts: any;
  attachments: any;
  createdAt: Date;
}

// Get user by email from profiles table
export async function getUser(email: string): Promise<User[]> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name")
      .eq("email", email);

    if (error) throw error;
    return data || [];
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get user by email");
  }
}

// Get user by ID from profiles table
export async function getUserById(id: string): Promise<User | null> {
  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, email, full_name, company_name")
      .eq("id", id)
      .single();

    if (error) return null;
    return data;
  } catch (_error) {
    return null;
  }
}

// Create user - NOT NEEDED for SmartCFO (uses Supabase Auth)
export async function createUser(_email: string, _password: string) {
  throw new ChatSDKError(
    "bad_request:database",
    "User creation should be done via Supabase Auth, not here"
  );
}

// Create guest user - NOT SUPPORTED for SmartCFO
export async function createGuestUser() {
  throw new ChatSDKError(
    "bad_request:database",
    "Guest users not supported. Please login with your SmartCFO account."
  );
}

// Save chat to chat_conversations table
export async function saveChat({
  id,
  userId,
  title,
  visibility,
}: {
  id: string;
  userId: string;
  title: string;
  visibility: VisibilityType;
}) {
  try {
    const { error } = await supabase.from("chat_conversations").insert({
      id,
      user_id: userId,
      messages: [],
      current_context: { title, visibility },
      status: "active",
    });

    if (error) throw error;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save chat");
  }
}

// Delete chat by ID
export async function deleteChatById({ id }: { id: string }) {
  try {
    // First delete pending actions
    await supabase.from("chat_pending_actions").delete().eq("conversation_id", id);

    // Then delete the conversation
    const { data, error } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("id", id)
      .select()
      .single();

    if (error) throw error;
    return data;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to delete chat by id");
  }
}

// Delete all chats by user ID
export async function deleteAllChatsByUserId({ userId }: { userId: string }) {
  try {
    // Get all user's chats
    const { data: userChats } = await supabase
      .from("chat_conversations")
      .select("id")
      .eq("user_id", userId);

    if (!userChats || userChats.length === 0) {
      return { deletedCount: 0 };
    }

    const chatIds = userChats.map((c) => c.id);

    // Delete pending actions for these chats
    await supabase.from("chat_pending_actions").delete().in("conversation_id", chatIds);

    // Delete all conversations
    const { data } = await supabase
      .from("chat_conversations")
      .delete()
      .eq("user_id", userId)
      .select();

    return { deletedCount: data?.length || 0 };
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to delete all chats by user id");
  }
}

// Get chats by user ID with pagination
export async function getChatsByUserId({
  id,
  limit,
  startingAfter,
  endingBefore,
}: {
  id: string;
  limit: number;
  startingAfter: string | null;
  endingBefore: string | null;
}) {
  try {
    let query = supabase
      .from("chat_conversations")
      .select("*")
      .eq("user_id", id)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (startingAfter) {
      const { data: afterChat } = await supabase
        .from("chat_conversations")
        .select("created_at")
        .eq("id", startingAfter)
        .single();

      if (afterChat) {
        query = query.gt("created_at", afterChat.created_at);
      }
    }

    if (endingBefore) {
      const { data: beforeChat } = await supabase
        .from("chat_conversations")
        .select("created_at")
        .eq("id", endingBefore)
        .single();

      if (beforeChat) {
        query = query.lt("created_at", beforeChat.created_at);
      }
    }

    const { data, error } = await query;

    if (error) throw error;

    const chats = data || [];
    const hasMore = chats.length > limit;

    // Map to template format
    const mappedChats = (hasMore ? chats.slice(0, limit) : chats).map((c) => ({
      id: c.id,
      userId: c.user_id,
      title: c.current_context?.title || "Untitled Chat",
      visibility: c.current_context?.visibility || "private",
      createdAt: new Date(c.created_at),
      lastContext: c.current_context?.lastContext || null,
    }));

    return { chats: mappedChats, hasMore };
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chats by user id");
  }
}

// Get chat by ID
export async function getChatById({ id }: { id: string }) {
  try {
    const { data, error } = await supabase
      .from("chat_conversations")
      .select("*")
      .eq("id", id)
      .single();

    if (error || !data) return null;

    return {
      id: data.id,
      userId: data.user_id,
      title: data.current_context?.title || "Untitled Chat",
      visibility: data.current_context?.visibility || "private",
      createdAt: new Date(data.created_at),
      lastContext: data.current_context?.lastContext || null,
    };
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get chat by id");
  }
}

// Save messages - append to the messages JSONB array in chat_conversations
export async function saveMessages({ messages }: { messages: DBMessage[] }) {
  try {
    if (messages.length === 0) return;

    const chatId = messages[0].chatId;

    // Get current messages
    const { data: chat, error: fetchError } = await supabase
      .from("chat_conversations")
      .select("messages")
      .eq("id", chatId)
      .single();

    if (fetchError) throw fetchError;

    // Append new messages
    const existingMessages = chat?.messages || [];
    const newMessages = messages.map((m) => ({
      id: m.id,
      role: m.role,
      parts: m.parts,
      attachments: m.attachments,
      createdAt: m.createdAt.toISOString(),
    }));

    const { error } = await supabase
      .from("chat_conversations")
      .update({
        messages: [...existingMessages, ...newMessages],
        updated_at: new Date().toISOString(),
      })
      .eq("id", chatId);

    if (error) throw error;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to save messages");
  }
}

// Get messages by chat ID
export async function getMessagesByChatId({ id }: { id: string }) {
  try {
    const { data, error } = await supabase
      .from("chat_conversations")
      .select("messages")
      .eq("id", id)
      .single();

    if (error) throw error;

    const messages = data?.messages || [];
    return messages.map((m: any) => ({
      id: m.id,
      chatId: id,
      role: m.role,
      parts: m.parts,
      attachments: m.attachments || [],
      createdAt: new Date(m.createdAt),
    }));
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get messages by chat id");
  }
}

// Vote message - store in context or skip (not critical for SmartCFO)
export async function voteMessage({
  chatId,
  messageId,
  type,
}: {
  chatId: string;
  messageId: string;
  type: "up" | "down";
}) {
  // Optional: Store vote in current_context if needed
  // For now, just log and return success
  console.log(`Vote ${type} for message ${messageId} in chat ${chatId}`);
  return;
}

// Get votes by chat ID
export async function getVotesByChatId({ id }: { id: string }) {
  // Return empty array - votes not stored separately in SmartCFO
  return [];
}

// Document functions - skip these for SmartCFO (not needed for chat)
export async function saveDocument(params: any) {
  console.log("saveDocument called but not implemented for SmartCFO");
  return [];
}

export async function getDocumentsById({ id }: { id: string }) {
  return [];
}

export async function getDocumentById({ id }: { id: string }) {
  return null;
}

export async function deleteDocumentsByIdAfterTimestamp(params: any) {
  return [];
}

export async function saveSuggestions(params: any) {
  return;
}

export async function getSuggestionsByDocumentId(params: any) {
  return [];
}

// Get message by ID
export async function getMessageById({ id }: { id: string }): Promise<DBMessage[]> {
  // Would need to search through all chats - not efficient
  // Return empty for now
  return [];
}

// Delete messages after timestamp
export async function deleteMessagesByChatIdAfterTimestamp({
  chatId,
  timestamp,
}: {
  chatId: string;
  timestamp: Date;
}) {
  try {
    const { data: chat, error: fetchError } = await supabase
      .from("chat_conversations")
      .select("messages")
      .eq("id", chatId)
      .single();

    if (fetchError) throw fetchError;

    const messages = chat?.messages || [];
    const filteredMessages = messages.filter(
      (m: any) => new Date(m.createdAt) < timestamp
    );

    const { error } = await supabase
      .from("chat_conversations")
      .update({ messages: filteredMessages })
      .eq("id", chatId);

    if (error) throw error;
  } catch (_error) {
    throw new ChatSDKError(
      "bad_request:database",
      "Failed to delete messages by chat id after timestamp"
    );
  }
}

// Update chat visibility
export async function updateChatVisibilityById({
  chatId,
  visibility,
}: {
  chatId: string;
  visibility: "private" | "public";
}) {
  try {
    const { data: chat, error: fetchError } = await supabase
      .from("chat_conversations")
      .select("current_context")
      .eq("id", chatId)
      .single();

    if (fetchError) throw fetchError;

    const context = chat?.current_context || {};
    context.visibility = visibility;

    const { error } = await supabase
      .from("chat_conversations")
      .update({ current_context: context })
      .eq("id", chatId);

    if (error) throw error;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to update chat visibility");
  }
}

// Update chat last context
export async function updateChatLastContextById({
  chatId,
  context,
}: {
  chatId: string;
  context: AppUsage;
}) {
  try {
    const { data: chat, error: fetchError } = await supabase
      .from("chat_conversations")
      .select("current_context")
      .eq("id", chatId)
      .single();

    if (fetchError) return;

    const existingContext = chat?.current_context || {};
    existingContext.lastContext = context;

    await supabase
      .from("chat_conversations")
      .update({ current_context: existingContext })
      .eq("id", chatId);
  } catch (_error) {
    console.warn("Failed to update lastContext for chat", chatId);
  }
}

// Get message count by user ID (for rate limiting)
export async function getMessageCountByUserId({
  id,
  differenceInHours,
}: {
  id: string;
  differenceInHours: number;
}) {
  try {
    // Check ai_credits table for SmartCFO's rate limiting
    const { data, error } = await supabase
      .from("ai_credits")
      .select("credits_used_today")
      .eq("user_id", id)
      .single();

    if (error) {
      // No record means 0 usage
      return 0;
    }

    return data?.credits_used_today || 0;
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get message count");
  }
}

// Stream ID functions - use current_context for storage
export async function createStreamId({
  streamId,
  chatId,
}: {
  streamId: string;
  chatId: string;
}) {
  try {
    const { data: chat, error: fetchError } = await supabase
      .from("chat_conversations")
      .select("current_context")
      .eq("id", chatId)
      .single();

    if (fetchError) throw fetchError;

    const context = chat?.current_context || {};
    const streamIds = context.streamIds || [];
    streamIds.push({ id: streamId, createdAt: new Date().toISOString() });
    context.streamIds = streamIds;

    await supabase
      .from("chat_conversations")
      .update({ current_context: context })
      .eq("id", chatId);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to create stream id");
  }
}

export async function getStreamIdsByChatId({ chatId }: { chatId: string }) {
  try {
    const { data, error } = await supabase
      .from("chat_conversations")
      .select("current_context")
      .eq("id", chatId)
      .single();

    if (error) throw error;

    const streamIds = data?.current_context?.streamIds || [];
    return streamIds.map((s: any) => s.id);
  } catch (_error) {
    throw new ChatSDKError("bad_request:database", "Failed to get stream ids");
  }
}

// Helper: Generate hashed password (not used for SmartCFO)
export function generateHashedPassword(_password: string): string {
  throw new Error("Password hashing should be done via Supabase Auth");
}
