현장매니저 소개 페이지 (웹 배포용)
=====================================

이 폴더가 https://work-report-826ec.web.app 에 올라갑니다.

  index.html   소개 페이지 본문 (www/intro.html 과 같은 내용)
  intro/       아이콘 · 앱 화면 5장 · QR

배포
----
  cd C:\aircon-report
  firebase deploy --only hosting

  ※ --only hosting 을 꼭 붙이세요. 안 붙이면 functions 까지 같이 배포됩니다.

내용을 고쳤을 때
----------------
앱 안에서 열리는 것(www/intro.html)과 웹에 올라가는 것(site/index.html)은
같은 내용의 파일 두 벌입니다. 한쪽을 고치면 다른 쪽도 맞춰야 합니다.

  copy /Y C:\aircon-report\www\intro.html C:\aircon-report\site\index.html
  xcopy /Y C:\aircon-report\www\intro\* C:\aircon-report\site\intro\

그 다음 firebase deploy --only hosting 다시.

한 줄로 하려면
--------------
  cd C:\aircon-report && copy /Y www\intro.html site\index.html && xcopy /Y www\intro\* site\intro\ && firebase deploy --only hosting

앱 쪽 연결
----------
js/legal.js 의 INTRO_URL 이 이 주소를 가리킵니다.
설정 > 앱 정보 > 현장매니저 소개 > 지인에게 보내기 를 누르면
이 주소 + Play 스토어 주소가 함께 공유됩니다.

같은 파일의 OPENCHAT_URL 은 카카오톡 오픈채팅방 주소입니다.
설정 > 앱 정보 > 사용자 오픈채팅방, 온보딩 마지막 화면 두 곳이 이 값을 씁니다.

변경 이력
---------
2026-08-12  최초 배포 (7장 구성)
2026-08-17  MULTI-WORK '여러 가지 일을 하셔도 서로 섞이지 않습니다' 섹션 추가
            + 앱 화면 2장 추가 (shot-industry-pick.jpg / shot-industry-cal.jpg)
            + FAQ '여러 가지 일을 함께 하는데 괜찮나요?' 추가
