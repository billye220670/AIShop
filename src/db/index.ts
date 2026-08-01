/**
 * 数据层统一出口。
 *
 * 上层代码只从这里导入，不直接引用各 repo 文件——将来加服务端同步时，
 * 这一层是唯一需要改的边界。
 */
export * from './schema';
export * from './seq';
export { getDB, closeDB } from './open';

export {
  putBlob,
  putBlobFromDataUrl,
  getBlob,
  getBlobs,
  retainBlobs,
  releaseBlobs,
  sweepOrphanBlobs,
  getBlobStats,
} from './blobRepo';

export {
  blobRefUrl,
  parseBlobRefUrl,
  isBlobRefUrl,
  inlineBlobsForApi,
  toPreview,
  toStored,
  fromStored,
} from './messageCodec';

export {
  newConversationId,
  createConversationRecord,
  listConversations,
  getConversation,
  putConversation,
  patchConversation,
  touchAfterMessage,
  deleteConversation,
  deleteConversations,
} from './conversationRepo';

export {
  getAllMessages,
  getRecentMessages,
  getMessagesBefore,
  getMessageRange,
  getMessageSeq,
  getHeadSeq,
  countMessages,
  appendMessage,
  insertMessageAfter,
  putMessage,
  putMessages,
  markCompressed,
  deleteMessage,
  deleteConversationMessages,
} from './messageRepo';

export {
  newNodeId,
  listNodes,
  getNode,
  putNode,
  updateNodeSummary,
  markNodeStale,
  deleteNode,
  putPlan,
  listPlans,
  getLatestPlan,
} from './contextRepo';

export {
  nodeToSegment,
  nodesToSegments,
  createSummaryNode,
} from './contextNodeCodec';

export { searchMessages, tokenize } from './retrievalRepo';
export type { SearchHit } from './retrievalRepo';
