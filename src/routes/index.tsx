import { createFileRoute } from "@tanstack/react-router";
import { WordKok } from "@/components/WordKok";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "단어콕 — 사진 찍고 바로 영단어 퀴즈" },
      { name: "description", content: "단어장 사진을 찍으면 영단어와 뜻을 읽어 바로 받아쓰기 퀴즈를 만들어 주는 앱" },
      { property: "og:title", content: "단어콕 — 사진 찍고 바로 영단어 퀴즈" },
      { property: "og:description", content: "단어장 사진으로 만드는 초등학생용 영단어 퀴즈" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: WordKok,
});
