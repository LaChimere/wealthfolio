export const AI_CHAT_ERROR_STATUS_BY_CODE: Record<string, number> = {
  INVALID_INPUT: 400,
  MISSING_API_KEY: 400,
  PROVIDER_ERROR: 502,
  TOOL_NOT_FOUND: 400,
  TOOL_NOT_ALLOWED: 403,
  TOOL_EXECUTION_FAILED: 500,
  THREAD_NOT_FOUND: 404,
  INVALID_CURSOR: 400,
  CORE_ERROR: 500,
  INTERNAL_ERROR: 500,
  invalid_input: 400,
  missing_api_key: 400,
  provider_error: 502,
  tool_not_found: 400,
  tool_not_allowed: 403,
  tool_execution_failed: 500,
  thread_not_found: 404,
  invalid_cursor: 400,
  core_error: 500,
  internal_error: 500,
  not_found: 404,
};

export interface AiChatServiceErrorShape {
  code?: string;
  error?: string;
  message?: string;
  status?: number;
}

export interface AiChatListThreadsRequest {
  cursor?: string;
  limit?: number;
  search?: string;
}

export interface AiChatUpdateThreadRequest {
  title?: string;
  isPinned?: boolean;
}

export interface AiChatUpdateToolResultRequest {
  threadId: string;
  toolCallId: string;
  resultPatch: unknown;
}

export interface AiChatService {
  sendMessage(
    request: Record<string, unknown>,
  ): Promise<AsyncIterable<unknown>> | AsyncIterable<unknown>;
  listThreads(request: AiChatListThreadsRequest): Promise<unknown> | unknown;
  getThread(
    threadId: string,
  ): Promise<Record<string, unknown> | null> | Record<string, unknown> | null;
  getMessages(threadId: string): Promise<unknown[]> | unknown[];
  updateThread(threadId: string, request: AiChatUpdateThreadRequest): Promise<unknown> | unknown;
  deleteThread(threadId: string): Promise<void> | void;
  updateToolResult(request: AiChatUpdateToolResultRequest): Promise<unknown> | unknown;
}
