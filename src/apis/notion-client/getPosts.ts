import { CONFIG } from "site.config";
import { NotionAPI } from "notion-client";
import { idToUuid } from "notion-utils";

import getAllPageIds from "src/libs/utils/notion/getAllPageIds";
import getPageProperties from "src/libs/utils/notion/getPageProperties";
import { TPosts } from "src/types";

/**
 * Notion API 요청을 재시도하는 함수 (최대 3번)
 */
const retryFetch = async (fn: Function, retries = 3) => {
  let attempts = 0;
  while (attempts < retries) {
    try {
      return await fn();
    } catch (error) {
      attempts++;
      console.error(`🔴 Notion API 요청 실패. 재시도 중... (${attempts}/${retries})`, error);
      if (attempts >= retries) throw new Error("⚠️ Notion API 요청 실패 (최대 재시도 횟수 초과)");
      await new Promise((resolve) => setTimeout(resolve, 2000)); // 2초 대기 후 재시도
    }
  }
};

/**
 * Notion에서 게시글 데이터 가져오기
 */
export const getPosts = async () => {
  try {
    let id = CONFIG.notionConfig.pageId as string;
    const api = new NotionAPI();

    // API 요청을 재시도 로직과 함께 실행
    const response = await retryFetch(() => api.getPage(id));

    id = idToUuid(id);
    const collection = Object.values(response.collection)[0]?.value;
    const block = response.block;
    const schema = collection?.schema;

    const rawMetadata = block[id]?.value;

    // 📌 올바른 데이터인지 체크
    if (!rawMetadata || !["collection_view_page", "collection_view"].includes(rawMetadata?.type)) {
      console.warn("⚠️ 올바르지 않은 Notion 페이지 형식입니다.");
      return [];
    }

    // ✅ 페이지 ID 가져오기
    const pageIds = getAllPageIds(response);
    const tempBlock = await retryFetch(() => api.getBlocks(pageIds));

    const posts: TPosts = [];
    for (const pageId of pageIds) {
      const properties = (await getPageProperties(pageId, tempBlock.recordMap.block, schema)) || null;
      if (!tempBlock.recordMap.block[pageId]) continue;

      // 📌 필요한 데이터만 추가
      posts.push({
        id: pageId,
        title: properties?.title || "제목 없음",
        createdTime: new Date(tempBlock.recordMap.block[pageId]?.value?.created_time).toISOString(),
        fullWidth: (tempBlock.recordMap.block[pageId]?.value?.format as any)?.page_full_width ?? false,
        date: properties?.date?.start_date || null,
      });
    }

    // ✅ 날짜 기준 정렬 (최신 글 순)
    posts.sort((a, b) => new Date(b.date || b.createdTime).getTime() - new Date(a.date || a.createdTime).getTime());

    return posts;
  } catch (error) {
    console.error("❌ getPosts() 에러 발생:", error);
    return []; // 오류 발생 시 빈 배열 반환
  }
};
