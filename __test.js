/* 임시 검증 스크립트 — 카카오 첫 로그인(프로필 미완성) 강제 입력 흐름 확인 후 삭제 예정 */
(function () {
  var log = [];
  function out(name, ok, extra) { log.push((ok ? "PASS " : "FAIL ") + name + (extra ? " :: " + extra : "")); }
  function done() {
    var pre = document.createElement("pre");
    pre.id = "__result";
    pre.style.cssText = "position:fixed;left:0;top:0;z-index:99999;background:#000;color:#0f0;font:12px monospace;white-space:pre-wrap;padding:8px;margin:0;max-height:100%;overflow:auto";
    pre.textContent = log.join("\n");
    document.body.appendChild(pre);
    document.title = "TEST " + (log.filter(function (l) { return l.indexOf("FAIL") === 0; }).length) + " fails";
  }

  function fire(ev) { document.dispatchEvent(ev); }

  window.addEventListener("load", function () {
    setTimeout(function () {
      var S = window.APOStore;
      if (!S) { out("APOStore 로드", false); done(); return; }

      /* 카카오 첫 로그인 사용자 흉내: 이메일 없음, 이름/번호 없음, 프로필 미완성 */
      var fake = { id: "test-uid", email: null, user_metadata: {}, app_metadata: { provider: "kakao" }, identities: [{ provider: "kakao" }] };
      S.user = function () { return fake; };
      S.myProfile = function () { return Promise.resolve({ name: "", phone: "", needs_phone: true, blocked: false, block_reason: "" }); };
      S.isAdminUser = function () { return false; };
      var savedCall = null, refreshed = 0;
      S.saveMyProfile = function (n, p) { savedCall = [n, p]; return Promise.resolve({ name: n, phone: p }); };
      S.checkPhoneAvailable = function () { return Promise.resolve({ ok: true, checked: true }); };
      var origProfile = S.myProfile;
      S.myProfile = function (force) { refreshed++; return origProfile(force); };

      /* 로그인 직후 신호 */
      window.dispatchEvent(new Event("apo:auth"));

      setTimeout(function () {
        var modal = document.getElementById("profileModal");
        out("프로필 모달 강제 노출", !!modal && !modal.hidden);
        var x = document.querySelector("#profileModal .modal__close");
        out("닫기 X 숨김", !!x && x.style.display === "none", x ? "display=" + x.style.display : "no button");
        out("버튼 문구 [가입 완료]", (document.getElementById("profileSave") || {}).textContent === "가입 완료");

        /* Esc 로 닫기 시도 */
        fire(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        setTimeout(function () {
          out("Esc 로 안 닫힘", !modal.hidden);

          /* 배경 클릭 시도 */
          var bd = document.querySelector("#profileModal .modal__backdrop");
          if (bd) bd.dispatchEvent(new MouseEvent("click", { bubbles: true }));
          setTimeout(function () {
            out("배경 클릭으로 안 닫힘", !modal.hidden);

            /* 빈 값 제출 차단 */
            var form = document.getElementById("profileForm");
            form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
            setTimeout(function () {
              out("빈 값이면 저장 안 됨", savedCall === null);
              out("이름 오류 표시", (document.getElementById("profileNameErr") || {}).hidden === false || (document.getElementById("profileError") || {}).hidden === false);

              /* 정상 입력 후 저장 */
              document.getElementById("profileName").value = "김테스트";
              document.getElementById("profilePhone").value = "010-1234-5678";
              form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
              setTimeout(function () {
                out("저장 호출 이름/번호", !!savedCall && savedCall[0] === "김테스트" && savedCall[1] === "01012345678", savedCall ? savedCall.join(" / ") : "not called");
                out("저장 후 모달 닫힘", modal.hidden);
                out("프로필 재조회(my_profile) 호출", refreshed > 0, "calls=" + refreshed);
                out("X 버튼 복구", (document.querySelector("#profileModal .modal__close") || {}).style.display === "");
                /* 강제 모드 해제 확인: 다시 열면 X 가 보여야 함 */
                done();
              }, 400);
            }, 200);
          }, 200);
        }, 200);
      }, 900);
    }, 1200);
  });
})();
