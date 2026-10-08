# Word Snap

단어콕이라는 모바일 우선 영어 단어 퀴즈 웹앱을 만들어줘. iPhone/iPad Safari에서 바로 사용하고 홈 화면에 추가할 수 있게 해줘. 첫 화면은 단어장 사진 촬영 또는 사진 보관함 선택. 유료 AI API 없이 브라우저에서 가능한 OCR을 사용해 표 형태 이미지에서 영단어와 같은 행의 한국어 뜻을 추출해. DAY 제목, 번호, QR코드, 손글씨 체크/밑줄은 제외하고 한 단어의 여러 한국어 뜻은 모두 유지해. OCR 결과 화면에서 인식 개수를 표시하고 영단어/뜻을 수정·삭제·추가할 수 있게 하며 불확실한 항목은 표시해. OCR 실패 시에도 수동 입력으로 계속 가능해야 해. 퀴즈는 한국어 뜻을 크게 보여주고 영어 단어를 직접 입력하는 방식. 전체 단어를 랜덤 순서로 출제하고 틀린 단어는 뒤에서 다시 출제하되 최초 오답 여부와 오답 횟수를 유지해. 제출 즉시 정오답과 정답 철자를 보여줘. 진행도와 마치기 버튼을 제공해. 결과에는 전체 단어 수, 첫 시도 정답, 틀린 후 정답, 아직 틀림, 정답률, 단어별 오답 횟수를 보여주고 '오답만 다시 풀기'를 제공해. 학습 기록과 누적 취약 단어는 브라우저 로컬 저장소에 보관해. 회원가입 없이 사용하고, 한국어 UI와 큰 터치 영역, 초등학생이 쓰기 쉬운 깔끔한 iOS 느낌의 반응형 디자인으로 만들어줘. 테스트를 쉽게 하기 위해 DAY 20 샘플 데이터 40개를 불러오는 버튼도 넣어줘. 샘플에는 traffic-교통, 통행, 수송량; major-주요한, 중대한 / 전공; route-경로, 길, 방법; vehicle-자동차, 탈것, 매개체; transport-수송하다, 이동시키다 / 수송, 이동; utilize-이용하다, 활용하다; remote-외진, 멀리 떨어진; leak-(물이) 새다, 유출하다 / 새는 곳, 누출; guess-~일 것 같다, 추측하다; temperature-온도, 기온; passage-통과, 통행, 통로; flat-평평한, 바람이 빠진, 납작한; enormous-거대한, 엄청난, 막대한; accurate-정확한, 정밀한; freeze-얼어붙다, 얼다 / 동결, 한파; gear-장비, 복장, 기구; license-면허증, 면허, 승낙 / 허가하다; construction-공사, 건설, 건축물; wireless-무선 시스템 / 무선의; nevertheless-그럼에도 불구하고, 그렇기는 하지만; barrier-장벽, 장애물; lift-들어 올리다, 기분이 좋아지다 / 승강기; curved-꺾인, 곡선인, 굽은; eliminate-없애다, 제거하다; commit-(범죄를) 저지르다, (활동 등에) 전념하다; commute-통근하다 / 통근(거리), 통학; drag-끌다, 끌고 가다; fasten-매다, 채우다, 잠그다; precise-정확한, 정밀한; vital-필수적인, 중요한, 생명에 관한; component-부품, 구성 요소; seldom-거의 ~이 아닌, 드물게; enhance-향상시키다, 높이다; sink-가라앉다, 침몰시키다 / 싱크대, 개수대; destination-목적지, 행선지; station-역, 정거장, 위치 / 배치하다 등을 포함해. 우선 처음부터 결과까지 실제로 동작하는 최소 완성 버전을 만들어.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/4655dd74-3333-4cc6-8694-4ec174c0dfa2).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
