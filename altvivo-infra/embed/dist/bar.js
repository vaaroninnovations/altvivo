/*!
 * <altvivo-topbar> v1.3.0 - shared AltVivo bar for every *.altvivo.bio app.
 * Zero dependencies. Waffle app switcher with licence status (licensed /
 * locked -> upgrade), live credit balance, account menu, silent session
 * refresh and cross-tab sign-out.
 *
 *   <script src="https://embed.altvivo.bio/bar.js" defer crossorigin="anonymous"></script>
 *   <altvivo-topbar app="xprism"></altvivo-topbar>
 *
 * One bar per page: an app puts its own logo and menu inside it instead of
 * drawing a second header.
 *   <altvivo-topbar app="xprism">
 *     <a slot="brand" href="/"><img src="/logo.png" alt="XPRISM"></a>   (replaces the app name)
 *     <a href="/modules/" aria-current="page">Modules</a>                (default slot: app menu)
 *     <button slot="actions">…</button>                                 (before credits)
 *   </altvivo-topbar>
 *
 * Attributes: app (current app id), api (default https://api.altvivo.bio),
 *             home (default https://altvivo.bio), theme (auto | light | dark),
 *             sticky (present by default; set sticky="false" to disable),
 *             logo (app logo image URL, same site or *.altvivo.bio; shown when no brand slot is given)
 * Events (bubble, composed): altvivo:session {detail:{user}}, altvivo:signedout
 * API: el.user, el.apps, el.refresh(), el.signOut()
 */
(() => {
  "use strict";
  if (typeof window === "undefined" || !window.customElements || customElements.get("altvivo-topbar")) return;

  const VERSION = "1.3.0";
  const CHANNEL = "altvivo-session";
  const VIP_ROLES = new Set(["SUPERADMIN", "ADVISORY_BOARD"]);
  // The AltVivo wordmark (light / dark), inlined by build.mjs from src/logos/.
  // Empty in the unbuilt source, which then shows the plain mark and name.
  const LOGOS = {"wordmark-light":"data:image/webp;base64,UklGRnwjAABXRUJQVlA4WAoAAAAQAAAAIQEANwAAQUxQSGURAAAB90c2aZPk/9NL54hIvJ0bAYhtG0mSJFftfd2Xf8DdO99dABH9nwBOK//lVfoHLs4YCfPI9FljLC7bMQ4M57zBc3vdmQxwUUUXn1Oqvcxkzk1kzpkBfAul2veJ3RuTOUhCQvZ8hyrtPgbkAtBsSbK5EEhOBag6UnoshziQJffhOPS74YZktz0WsWox6Z5JfEd60229GaxVS9Wxbq2aSWbSblzmotDdrVVVO3l7BhUNCGiCAgq4rEoV+wPnlQcqAG/Yth2TJG3bdhznGRGJynJNV3dV27Zta2zbnsZ4pqfHtu1p2zaKbVuF7EIirvM4flzndUVUVNe99HL/iogJYLWWUFAZ3Hg5MgBbbbfxxJFHF961nPByRGDiB+cZjsCSP6wH8nKDKMc/bvM/f/UD3pq196t2GzkF9GWGwCn22GuVyoNusTMmIS8rBL5sZ06B6A4iyRvfsauGVF5CguR0NRJVUVlzBY6zMyKR6iCcav8kvISs/hLIqqyhRKY9NncApa5EfmLvJawKEZEeCq8ekiCG7YusJjBh9qy1Z01lTR35rO1NpL5oc+6zk5BV0NOCfmc22fehGQmqJe0RkcaXjzNcxv82TWSNJMy5lkCngcPsfcRVEFv9Le0V8MVpNELRWs7qGfiSp7YI2L/QNZGybnqPxI5Q5txKQ7skTL3hgXseegOxV6QRGgohakZYf9eddnGzsI32hNB3YmER8NHhWegaKLBf2hHtLPLp9lSQIN1Za6kV9sEeUuorf7AxE1wfGUB6YkYyHGBsZNs11FEr1u+Gsq3df/KmQAjdmPnUirGBMXpdsAxET20EXOlFYYaTF3fWxIEDhtfrBqJHXzBiN7xrCAhSR1SDzho3GOg5RypcEAD3HpkaLOPixRpJWffFvSR0oTzjbVfa0t/uAwSpyg599uR26xqsZzwDWkXe6U2VBQeuVMD6H3KxNRDKrV8hdiUosNnXHrSF7+uHICXlw5eee9FvhGw3RBFQ6UQqpCORHuHT/92Q8rOnEVIPiaqqvCRE3nBPDNINkKDAQf8ce+aUqRCAwF/N7IEQGzEqHWtUqkOQOvVVQtKqECQERUMIJa0nIeQMn3bYWi62aBaiUnLxDjSEUtAqCVHISgyy2qHhxo/T6A4SQgTW/vqSZV+bhCiBX48uGr1dEDoPAgxuMLk/jC95YQkQpEKkwsg7kvFhel2pKfU6lgAwNHubLWcNAgTpLQ0xAq512HTBLjS6AwghwMSTlr7wLtDA383swW6Iwg6nXvTAcH/EVy557I5jJ4LmqBLQ7fs0zXYBER84YqnsudcmbL7XHnt5ctmiXt8euwuuRXjghfVnKgiyLc2dVaUQi8upK2y05+5J8d12bpUUmod864pHFrVHFz1w2XcPaYD2jkahZpQcyq7XHQTSmRB2HkJAAkw+3a7ejMj7zvj7md+lc4XjLx8zs6IANII98rk+NCPUSAN3z3LZP2kpTbsACvsnv7FxA3h+JlIRebuNR8r7Xv/nN6cApgukdc9mLuAyPBOp0ZhvCcTtnn6EQHz/fDOzYrydzMzufG8k9IgGYO3DPnT60LJnH90U0ByBjX75zgE61/BXu36qCCARtr190a4o3VVe8dYDG0UhigCOOy3u2BApeR20rQWJvBfgDefYNDIGJHsbsUI51tsRLC1okbQAiNZadpWPtNuQJr1JYkXgtuntAijsxwQC+7xta8ZNFHFw0yY3fexW6QUJsP5Hrhwze2bFWGPSsrknTyHkUDjsjdsMSAfClBeTHUSgLA2YfylBQwjakbLZfMZSpL4X/TPaOCBSYeAoSMlcHXBpM+WxNCaQ0lloTpi+j0WBwr4Fwcm6cy5BBPC/ESoiz8Yk4NY+kBD44BijROqa9Y28mx5U2OzXY/boT45fPxYwtOPHb3z0OEIOEWTmzMEOUPnx8ksmiZQkwlHFyQS6qbLOA2YBwM1BVCi3ef4pFep6SagU8gn+ZiMBPD0zFclEDpjRFsDTniAVFFz/UNOBwJOTkZxIqyGANe7rI3KSjYnSaYqhia+qQN8pK+3SEwaoe/Stb0ZVSqB0UWD9gIBogAlfSD9EpTv825ZTTk2hPK4l4I8rA7hlBAXMwDPuJBCP8JYMo3Y0IRM4FgGseXdLKWLORFdcJAmQth0nIaNsPo1y0fdLmrzRRsbImgGqJUzTE6ziyC632EOvAUJQwQWNytBZu1JXpCMQEDQC0096/vHjULoa2C+NjJdG7YV/z1/U2vpx8tZ3+y8SIBkw4LHJEDK4tgAmwTqLCgeM48kKUw5zLXEaLZS6Z5gCOMc52chnm4UAysHoZsPBKbs3KXsGwrPzVVZF5JXD9qtpSBDqRma+ly8eRsh1VyUosN9vnrv3w30EuvX79ooxAbNzN6B80o05wvibXJEqkPHPTvPGYvWSrPzXi6lo3UDkPDNA2a+ZBAgctlZbgGC708SqxOSGe5sGqB8yIUlJ5NoIYM37++DM6GSj3HDNk62tDkJzJmc8F1ZB4N3JPgyRTpWZ08e+QlwVQWDT0x9YfMbhQKC7wuSlZqmw1LxUCAKwfDvPWDgBqafjAA9lPDx9EtnIO4xSe5O90MyPMcAa86LEGgHC2CWUZHy9AwiAstUIUuIc2LsQsj78/v8ATPwfnvG48sdo1wJvLla8iih0HjkgfW5ViMKhFxXzP70uEISuzfzN5fcsngwcQFNKQb61xZgCRfM9CNSBIOKJygmj4pgp6w03HEh6LAJC6x60xIXEgFaYA+cQAJyjcSDyaSsAAufDv6zIpL4jrwkCFC+OkU/xl8RuBfZeUbyGBt2MnC4Nuh9g7yvs8sOBEIRV21x7l2M/9rXJSuXJp5EfBDxVOGVBKsSKwgGEK9QAZf+QQNltk3YpFmfh0M44DombHmg4oBzclwSMIxHAGg/ewowDLZRS43s0KWuUa1MqqZ/YT5dFpyywL9Cgm0L/HAa7Fxj8tc07CCQKq1aCUtlaZ3BQCcWH3y457wZoBUI+chJeKrbe3BXhOE2AxXl3SIICB3dUIIxcRCq1N94FRW29XU1LXLySnaa3BfDmop+oZoicYGTS+rt0K/BLO1eidCXIocZkvEuB3RbYyYoGejECm77l+xfe/UKrKS6uHnJZyTha4VXVynbtAFC0DkBJuh9a4qIUACXvlM9ICpDkeATlkAltAYL9B3bAAUyvfV7JCzMXNx2g0Hd0KXBg+7kNUbqq/GthsVaXJPB2e3QXJNCTgb63XTZsZtZ2B0eEfCh1KjWkCglzGwYIR2DqW21blGI6Gwek5EI5cf3dTQOUo5qFGCdStsbd1ytbIiXnVokVILdKBr7dJeUc+xqRrgbZ8eFX6oQuwdrcO50o9KIYR356a6ztIiIALlQ64F6hFVaBVEXOo6S+xzQLHNtXABbn3yEJ0JLmiHyLTLHpdgRbZy/TEhcXkRlkhYed6sB/yQjrdCewx+iTrxDtEhd8f9Cmq0tXBnhmmEBPinLA1oyKCrg7DqhWKCBSIRnQCvcq5ezxBiDt6fvjHIkAiXNSAPASoAIEdk0RoIjHEuSAKeMCRPs3iQlICZbidX6bg/5u/dy+T6CrgV2XzR5cMnMiXY2MtlF6M9BgVBVwayj5osIBBM94Rc0ayPz5wQDjKIoNdjQF13QeXtIKIdu4LxqgHC6FH0nZ4n1zSLTICkbNyK+p1K4Igw/YftK1m75D/7PTZiAdCaOAOr0ZeD8mAK7hxQefXTI8JrLjXl5HqiQjeFXdaJdTCuw9yCGD4wLemjtHUkkqkpciF5BJ22+RphzgocTF41FYmXMG6gT+WjXalcAe9ugQ0pXAJx4ZCDzemNVZZCkTQOhNYcqzfQ444flPbShO+Q1/s5yUlLxmIGYc8RpwGQpIe+NtOAEBjK8QKXuFUA78uwgA7dYJsu+stgDB/osLy/DcLKRKuBhBBOf5rkTeYWeidFPZcuXBNLmXzTuKPMNQi56NvMacsnM4oILEYgqeMwBHMtWOAQJS68aHmwakeGBzD1cgFjsTMrFKSsjtdzYMEI7yozHAGgtuFhOezsFOeIUw8AgCDjzYpa/bacRuSAhzf0OI3MU2dBg5jGnBeulXqSil1nk0lHJRbEttUeoLhlJOXieuOIeScujhU9sCFu9QIatIxjwT7WxKajtsuzda4swiuDCXrHJgv0kuyGE2riKKsrArgd/ZR7oT+dm9rSCB+9meVCuwzdLpU+hh5VKzUtF3WoiU1SccYSEnZD3jQaRUHVRFRDLOWa6A+HYnmQDGhcSc06FyQREBSQPfmO2lmM7DcG6xmBnf4HCPucgF5gDeWDSnS03adLPB51ZshKLMGl46C6kR2OyRJROQHoJbjNzfaKog6sv/qkYddwQQ/vcaOhw7boVRadx8f9MAJKRSGD8bzaWKoBlEbzajLIcnwOK8OWKYzJ0bDMDiXVdCcET5OxJwSHLtC6E7yxnqRoM32eEEQOQqO4ZYpUy80w5D6GHhCvOS6/Am5BclpZZIRtsr3nIjDWAML6XGNcUUjBUlD6OXksEFsMa8eUJe8IySj3yxgoISZ6YAHop/Swb0hWm0AdIIDrgpv0G6EXnU1+1MIq8q3kQEiJxk36mh2n++vYXejvwuZbDG3a/fYEKYuf07g3uVAWaUxSNPtT5Kg6Xklb0uljTwSQLls10zWeNCixWJfLJcYIexmJNSY/xMDEjyh2cbnnG2/uCxj8pmJ/aLU0rNqy/WohuBubKLpg4CfNreSaSsbDN+Xz+SkcA/7RRir73HyLvZ0oeaU/pxrMpxxpdnUEfiOigP4hk8DZp6gQDGDQ83vEZM56AVXlF4DtEbYsqUU7j9Lim5PvflkDII0z7ZpoELGfGTTeimMf2J0T0IdSTS3JBxqkWvTocSSiI8yGx6XZi5OIUM5g0lFYjEKgW1J9xLCOOxjXM+ksMRayTKHlZeJKnK4pw5QqVU1Ix8Dq9R2OeIlAU9Ac8go+NKIlCWJEfRqYQYA0jQn9v5NLRCIuywYPnj1Ay8xc7NSCTxCnXpMQJfnTwmGXBA3LmiLbkAypliGRACSa+5tlXkAHXPAP82rSo4N4UqrQhSoWw60qjBik3RDGLTNqBSogt5h41A6mig7rRH7cMQg2qICoOn2x1PUldkYH5xAA2C8iKTWyb0umhrD8Ry5SQsPEAt55Dkn3f2j3sGDEgfW97nXgEhZ9zyYNM0R/tcrCoiGfMKlOtCqkity1CqfaiNWKluamDRqakKbHDMx7/zmyFdMfylV/9ubPnJ/eTX+tiTdkrA6xA4zm4fQtBvYA1nNRSay+j3whzcXZtp8a37xSKZgTfAZeT1Dw1oKgocLcB0zgnP0O/JcUGqPIxemtohY8275kuN8aIoSonqyBneLnLFwAeJNYThu+nzwjznbjGOzCucalHY4dQzrzzr56d9iaGpWyxctMLMFnz+5idk1qfOH7H/bA5K/cAf7JJNmztebKPG6inw4Qc2otKv+QKyt5H/PGDKrD8sNTOA7xMhMPsHT5qRf28OONiMyu8QyQf++kay9wmSU9Z7WKjeFK2BwuvnmFl7dCWINITR/2yPUnuv0777pi2aVPdv9eqvX7rcAOzu07eCIHQoOnSGjd5n9rVRVlcRho46eLuZrfTi03eedR2RiQcjiBAXkgCF9V/7qVPTeHtkewQIMPXAt0+X5O1lYzeQMkbfez9WiAjuugFaIeyzVYrqpq+i9vvWS+oYqfkMHYrSOP6P96w0Axi+55L/QKDuzE98cnMAjTECLpRnHbpR//gjGwCqdC7w9otu+Mtu4KsLBIDBVlrZBhHqO4AEOtVAbc84L5kBaG12xLuHeP7xB58AVeoOvnUz0KBCtWiIQmVUuipkA6uzKAlA1RMgocKo1BBjSXMgIVYkasZYJbVUc6FekCrvDAmBmtGoPX0rCEIXNQi40nUJSlBWewGc/zOKhgi4G/UbE0B4eVMQ/t8nAFZQOCDwEQAA0EMAnQEqIgE4AD4pEIdCoaEKbN8qDAFCWwtJ/aFcBpecQAMTAAX7d+IHcNc36T+KP7d/3b5Sqp/S/vf+4/+i6Ykx/Xl+T/un7lf6f5sf7b/Efjd8jP0J/y/cA/TH+3f3X9zP7x88/9R/nfY9+4fqA/k39b/4P+W93T/LftF7hv7t/l/2A/x3yAfx7+v+lJ7A39k/y3sB/zT+x+rj/sv/B/l/3/+hf9of/H/l/30+gb+X/1j/mfnt8gHoAeo9/AP3w7kL+j/iT7ovHn9h+QGHla/FeblQgx65jmPChpOP2T/gewB+jfRUzmvWfsDfzT+9dZL9svYg/advR6WIU6dThQDse3ikd4Ci/SA6LQ0TupbrZKNmRTdYKfUMgmlDYWTdwN5eKcXDikDTpfjdYTDf6BOmCPRMDAV493urG19k7JbgZop0lzR+V7yg6+Y4BZ3A20OpjMQc0QxjcDEt9Dx8xLifNMqL02OT4IgT8qlxadZrgVli3eza/ZAtoddtbdNIipunjfg9AQC9bfMktphLxZPWULBgGTNxV8SQaxAw6qPkQnvwNHcWH/SRtt4h7Df9tUptgCkmU0jXnJmFZv/MGcBMbas16cl3t6XE8R3mEQEgqKI73HrZZuP+9Wr40btV55fS63xYz+rM5pCGBvXcY9e3Zx0hIk1cfS4PJZi4FpkuCp/ExHDAjqhb8k86c63+3XGFzrapHzHRGYwDxaZFD4gJYhXxV+AA/vlHgNQG9ZnWddv2LHCl4ZAj7MW66SDTYCls0tYiWmztzbOuHfqlv9bIAoHUSvzdwCaMgL1CHc/ws1luCwbaVYvruUPrM/PJ7p8kzc34pbMPo/3GPdKGlBr08GzhAAWeSmH33KU1S1BqntlcpgPwrxJC9lWcqnGcHL5z7eOBL6SsxRgUgqCi6i+NzuvvquLRSvlfhAkEezmSSmHOYGzfqB+aQ1s0e2ujTDMcRE8Uf7jz28dN1UnNcQMyru/LmylBkwHodx/9aGVY2EmIHhfDXO7K9VKsvPfaMwGe3kcUGgH9+uVaR1GPrtEItMD+vLJLdQY9Ky+LmcZhP/kgPxUduhJnsROYAy6+o6tplCJ6K8BgE5LpM+vYXQflJzaAj5zxkepMA6m5avRb0Cr7PLieeCEVHWopu7GT0ZemtgrqEY853jGoRD+7Djk/2VEMzHU25+t3w9oBsGAgAeKTx5eU/V3MJx3PnSOW1Q0GkyZVLuYZ23bcIqbByxqs623+C6fZSG7yfwvbUPB+VKP18zIGxth/SDRL+QuFNCJCVbjRyqU0ZCltZPNkqjvOTlLE8NQ9z8buvHa5vqdRzLG7ow7SpRH86bOgMjtEnWkKk9Ass+iAh3kYK0WA7Q8ng6Nf3PNJ7IBb/XYZ7EhFe9gNznDTpMCqQ0OfqhwVkG66691MYD6KL5j14Dp19YwgPSKKBX5d14RUVngXeoczJ3RuXTBV0el/rujCvNEFRgDmAOZ59G1ZcEJwLO3CUHEd5wwExFVB3hTv5O+0zhelkTaf8LhUks+9M+U9QX9K9RWrtjIabK1t5ExrKIxHIRyQ2FrsYQl8DGdEO82zCXYYzgSyyESAzXtM32doyEXcuc415xwEUed+YOEBLHJO8ZjE5wXFjrJ3rTlaE2C4Ii4TgY0Q3CLCvBFgyuqjyGcDZzaKjCpk9v35H2pbfn+bSmRWHxxQmpavcbQiuAaK/wwVq1anvLNv7/IhqC3qlwEY6InwAOqAGsONcGk9eMzJ8NVpRfH4rsf/DlFQzrtpykCKPvF3tMe/bdNZUXlnOmekSvRrZbI2sh+n9Yc/cIgvY/+2Ot4vSF7dff7EX4pYVYF5Lm0Aopel2umos/hpg86iPTk2Q7gmvIjfDYyKXf1pc7kns0UFkVVvGPrUgI1/ouu2tS3HkdL7mp6XADQiRIR5JIQwQBWVQ6PSvNZY2S/d79o7Pj3hKo3QbGNSSCQ3YOlFYnShTQmLaf5kExlJSqQGztV7ht/QAIrIwBAhZH2TvmcG9+aZDIlr5CovtBA3zWHzNeOG630zJ4ECrwniFbgL3imJVK8auxEF9H8MZue9OOE7U+JeTa/1rJwZrHNgBWey2k4Y2QBkpJiwvnAiY9MlLeJ6WbrdVLxm14OxkSrFLTjp4mM94JEXmUgYnnRbtEeCm538L18Dys/fRHklTOI6XO7ZSx7cSAZWwfpnJ4NlCuk7pyfj6aio+h24eU+JD8QISIc1DFv6qe7M6kbb+Vg14DSNsS75aqtPS9jh9YHc9d1/gv1B58EKgC6SoljDRFIs8qz9l0/0nGo6HP+UezGu7eXnD4JtVbvmKdQA8tFCnPFxXUgNy3A1VdtxedCLn+p30ozLIoIrkZa9c5gGsvVxKkpFZkSPjdImdYpPELUOWsrkaIhWDF6rTE38F7vc1Q6kD33k/OtSDFLNzR/JvwiLbYlu+PrMzKQflL7/RrnB4axVtB6Lqg1ynHqqZv0jzlXGUAHLo90IUXnQwRaRNhc6tzE8mawsbLwBSVf9IVVeEp4R2sCasq8iVBk5WZX4+LyMIBjk/WlJhGiUyuaEU4qldKl0NkqNVGGyan1N5LrxIDzSmKVd9ov9Oe1a5Ht/dZtYW1Gwoe30kn4QXFgPg+Si6rrbjAGWBtwrz1SRr8KeLUeO8EQYBacPc97u4SSg8UADsI94h1uc2vaoXyBmhTrV16DLgiuxk0KzBvgqFldViYEmO9mZHaKINw/DWpwrUrco0oc4jrf+k/WTfilIPdpVMsKU9T73cwurYdnydt2yeaHZIfW6bee711ahq7fGCMMu+WiDnopoIZTpOFJdJDFpJhn6Y321HJR2nyKxbK+6Wm1Klav3vdBxxlntE3iq4L1TyJs4MJyHpd/lSrrsH+owXq5wtW5T4SvMh0Tk8nZPu4NJrgYmqbSZWMicdLZ//EWPTiBMBnpTqEC9tsIm2qRUr2aC0n8Je6G3dU4xs/AltK9x7mpDndcwSCkPESZt2yEqddUBwdWLZEt1SZZDDrAsKMhWP8sarHWYJIPkDT2blw9INwZcoCNSPJ/O01xnutl48yHcFs75rRMVLcZ1cuQmEk2jbcHEboIPYF28XDKxkps/OvhlQcaDsKpX8YVvKWi8Mhk/HAPqUOFP0xK7O2nCKGdnP+3rVdAQIGPKx6EjrUqJAazo1ZcOm0WflvX7Luvh/I8Ia+MtL1O7aNTdtw0b9liWVlHAWSVLcL0bxjpmt9pXciCVji7iBtxc/HvphJAZERMgYBiWi/rL+gAF0FBLb9EFSahE6T8mCt2IeptmkbQubD82n41/47A1yH3nFb1v4i3vzbG0FneTomD17gZRF79qBADPtVmfbQM3HeWVdcOYWhEM/q+zfsBwiqXoveV/ENKThR01zEFt380dMkavmERk5ROcW1A+R+3zjUjGJkjXCzWThbFZYodwS+5UKialYbQwLzANd1YO49t///b3+xPJXM3PkHmgiL8Tq5h993AGwDyXr3wqW8o++ERBBGj4UHVKM8DfT4XydOQwK9NPrjxR0YzvOTt12DkpVnjyAylPU1HKHcRGDKUeMc2myR8hjKqM9We7dNDoV3YzloxCt0q3f0kmbzATVzIi9qzIN1Df7AGAq95OWO6D7MKkw4HCSdApKyZJ7jLiM6OWbqYaKsHOh8cdpagEe1ktP/hHFFq6EHoqIjCoaPIvNfasyNd96gmPGfaI3goRWcawEzHs4i6V3up/xYl/NevgZbbmXb4G3WR4GDU10gLYRf/5YKMIKuMrfop1QPfYJGAUzXSaNNeaG/MWI4QJC2epiefiI3mXMgkLTpGMEq81063XUvveN6p3eFhsudblROa9OXpjpsoui9U3encR/iohQRcZC/WafYUdbaxu53xXpNSJG7fKcc8YFVThQG3QdtxPplC2hVZHpMslcyEWzeT2nL8hFUHvXB5tA8HLwur4TMB1gGPG4Q0PprFoftSvoOVvwttkgTZ14IR0tLrvPwsRBmJ6WSS2mJjcQYf/8LnNAwnZgBa/wIhBcq7MxOWXwbWPJsrSieLX28pqaBx9gxvJ4eJAvON+PbiDpA9uDRkV2Jm6OzIJ5yvLP5Tuji8SFizTKeH67WS8OOhh9rNE9tQqxbJfEX09k4EuqJEjEGE/k8Sy82q4xqNAyqIczTxidkxZCK8CfeEjY1WUVNPLGMVypQg//g2aPLX+WigqPMn5elnYCsH4s66vtloOmwSKuRsIAP+d8jszjZHc/R6aHvjm1oEFZiftJLqj7gqHszCYHOzxll5x9BrTxDJSilUjyk2p8z4JPdUfL/3ZkOklU7rrfiiOwkXF6NgBMywARwl2m+/UuEM6HZGNijstIsW7yUA0II7N0kSyV9TgdlMfhqCGGmKMqwI52OQOsvAN2FAiKErHQdOIDxzMA57MtaaoQAiqNAX+rmTQOtU69uFscXuLV0/+G773ZbgW/XtwPxEuJRe6jco093NJmjNWgg1W8Pi8j5ZsDr0ryGzV1lgkg43o2s9jjRuu9i+4C000c95pNi2eaZZp5lw+jT8GkC+nqdBNhnM1QHnUYVQ7zaQVEiTQ5by7saMax22rj46uUppGQuvudmRQaA+SKHEbn0GJFcp0ElsEuCGRW75k6F3VyTU7H13icMRs4CnBtddHqsGxtWRD0K44bTEh1W2jK8KlavOeaaZJ53nY522ukgc1cGWFG276kB8tRGAByvmHaLXa0x3m6a7dc4NwaDG8wIALnzj890xJyAWB2mRDxY0U0pyxj4b+EFPfCD02J9WfotYzzf+fyXbed7fgyoHFfVho9QKwnoc8nqJPea8+AUbx84aue/y14xyFMp7pIVDdWjNFT/m3OMsWuW4g+BGSB/pzv3t9oqqf/zFBBPWOrUBRU983uODo+FvsDBCqw9DkgLDlCcVHCpIexRknhV+ROlIJKkhgG8valQQGT1ogfhoCprO4avfT80fA1k/ZfQ5D8yecfh1YDJaMWmx3zI9QX6UpeznN+psGPaAOvGDLfPW/qTKVLBeuUiUEmGjcmF4V4a03F0qOD2Gef/6s1W5EUCg9XVdUSGD5qNPYBoaqjrKoPIrsfcfOdw1PZ22D6VLM4M2kXyPmzsUV2CjM9lJyVJN+QARWLqVYJbwKruINIbJxSQMX0X2AhteeqJH5jq9UFwea9UFwdGRQTcJ3e2CzcZ7syB39a1qLWosB9uKREOQ3Oyvxa50IHeYfsWwhNpdwS75t/Q8eeUrTUFCsgFS5syP0hUcb69ZCdY1YnbPBxxM76rM+3TZxVzO66VBvn/YXIqEz+EsDYNj9o3DT8GMREmWSZhuvRGsnykZjeHMavZMk0Kqs/hrzqX++xdt9cNBHr9LGHPcbTwWYfpQkVG2N6F0b3Sse53Lub0u0EHfWbH01ybMsMt9VQYkGaVzO5gnoNhBjWIC2E62uU8K7z+sFXaLtGY7r0xJ6qw6BqdNxvxdP5F3TRZVw83isNUku5VkfTg9rk0A2AIV3MQxUb0ozKSiy62NMfbTZpoHyIRYnbRKT5dlrqjbirYjNptY4jYzGatOptErkX4IOYcWn8obK0EY1kodnvVRvzv9EslhLAbXk8YQndXe8gapD6AvC6MrbLUI+ZlRYxzlTa7GUXHSRzVjAN6zKcM1Cu62G+2EJ5rrmYHG308Jdm/eIp3hDQOwtqYm6g/yg4KS7CygTehTWg5hvlhjMNxTOJZ2scpy9VifjJQJt7mu2V4ZkHdT8SVEO9m3eGyNXxrMBz5YqEl8pB6p5Jv2gJif7JFkDPc8Ab2GgoWlVwc7n4oTjwEsnPHFQk0yehoWpGLGMCeXNy/oFo//vZhuoxHuQZ+iR9fn64ZOUgA7Ad3Y9iyRjF8yImYDUstfL6/2P/97g/9R2JFtbMOD3dE7VeuMyfxb5NPQmOBJAGbtpoUxZST0WkqOMeGK+O3Y4TbMRcOpEhH1d3MdYEEvgiPltswwrQLJAysBhIYKaBPh6yJL4Xtis7X5CatlWHAFK0wY8nHyfK/8hgp6Z3Y71nRK2+g4i/EnIP8bES7oDn1akIN2OrwRTAVJoAqLnefeEX6yEaVnRqDTEZau4B+90mOWcxNfqEQjtg07Ps0yzjmgfQxSJNtEmzHhirgvf/5zSEfNQAAA=","wordmark-dark":"data:image/webp;base64,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"};

  // --------------------------------------------------------------- icons ---
  // 24x24 stroke paths (lucide-style), drawn with DOM APIs (no innerHTML).
  const ICONS = {
    grid: ["M4 4h4v4H4z", "M10 4h4v4h-4z", "M16 4h4v4h-4z", "M4 10h4v4H4z", "M10 10h4v4h-4z", "M16 10h4v4h-4z", "M4 16h4v4H4z", "M10 16h4v4h-4z", "M16 16h4v4h-4z"],
    "flask-conical": ["M10 2v7.31L4.5 19.5A1.5 1.5 0 0 0 5.8 22h12.4a1.5 1.5 0 0 0 1.3-2.5L14 9.31V2", "M8.5 2h7", "M7 16h10"],
    "scan-eye": ["M3 7V5a2 2 0 0 1 2-2h2", "M17 3h2a2 2 0 0 1 2 2v2", "M21 17v2a2 2 0 0 1-2 2h-2", "M7 21H5a2 2 0 0 1-2-2v-2", "M5 12s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z", "M12 13a1 1 0 1 0 0-2 1 1 0 0 0 0 2z"],
    box: ["M21 8 12 3 3 8v8l9 5 9-5z", "M3 8l9 5 9-5", "M12 13v8"],
    zap: ["M13 2 3 14h9l-1 8 10-12h-9l1-8z"],
    lock: ["M5 11h14v10H5z", "M8 11V7a4 4 0 0 1 8 0v4"],
    chevron: ["m6 9 6 6 6-6"],
    external: ["M15 3h6v6", "M10 14 21 3", "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"],
  };

  const SVG_NS = "http://www.w3.org/2000/svg";
  function icon(name, size = 18) {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "none");
    svg.setAttribute("stroke", "currentColor");
    svg.setAttribute("stroke-width", "1.8");
    svg.setAttribute("stroke-linecap", "round");
    svg.setAttribute("stroke-linejoin", "round");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of ICONS[name] || ICONS.box) {
      const p = document.createElementNS(SVG_NS, "path");
      p.setAttribute("d", d);
      svg.appendChild(p);
    }
    return svg;
  }

  function el(tag, attrs = {}, ...children) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else n.setAttribute(k, v === true ? "" : String(v));
    }
    for (const c of children) if (c != null) n.append(c);
    return n;
  }

  // ---------------------------------------------------------------- styles --
  const CSS = `
:host { --av-bg:#ffffff; --av-fg:#0B0F19; --av-muted:#64748B; --av-line:#E2E8F0; --av-soft:#F1F5F9;
  --av-accent:#0EA5E9; --av-accent-ink:#0369A1; --av-live:#10B981; --av-warn:#F59E0B; --av-shadow:0 12px 32px rgba(15,23,42,.14);
  display:block; position:sticky; top:0; z-index:2147483000; font-family:"Plus Jakarta Sans",Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;
  font-size:14px; line-height:1.3; color:var(--av-fg); -webkit-font-smoothing:antialiased; }
:host([sticky="false"]) { position:relative; }
:host([data-theme="dark"]) { --av-bg:#070B14; --av-fg:#F8FAFC; --av-muted:#94A3B8; --av-line:#1E293B; --av-soft:#111827;
  --av-accent-ink:#7DD3FC; --av-shadow:0 12px 32px rgba(0,0,0,.5); }
*, *::before, *::after { box-sizing:border-box; }
.bar { height:48px; display:flex; align-items:center; gap:8px; padding:0 12px; background:var(--av-bg);
  border-bottom:1px solid var(--av-line); }
a { color:inherit; text-decoration:none; }
button { font:inherit; color:inherit; background:none; border:0; cursor:pointer; }
:focus-visible { outline:2px solid var(--av-accent); outline-offset:2px; border-radius:8px; }
.brand { display:flex; align-items:center; gap:8px; font-weight:700; letter-spacing:-.01em; padding:4px 6px; border-radius:8px; }
.brand img { height:26px; width:auto; display:none; }
:host([data-theme="light"]) .brand .wm.lt, :host([data-theme="dark"]) .brand .wm.dk { display:block; }
.mark { width:22px; height:22px; border-radius:6px; background:linear-gradient(135deg,#0EA5E9,#10B981); display:grid; place-items:center; color:#fff; }
.sep { width:1px; height:20px; background:var(--av-line); margin:0 2px; }
.current { font-weight:600; color:var(--av-muted); white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:40vw; }
.spacer { flex:1; }
.applogo { display:flex; align-items:center; height:36px; padding:0 4px; border-radius:8px; flex-shrink:0; }
.applogo img { height:28px; width:auto; display:block; }
:host([data-theme="dark"]) .applogo img { background:#fff; border-radius:6px; padding:2px 6px; }
::slotted([slot="brand"]) { display:flex; align-items:center; flex-shrink:0; height:36px; }
.nav { flex:1; min-width:0; display:flex; align-items:center; gap:2px; overflow-x:auto; scrollbar-width:none; margin-left:6px; }
.nav::-webkit-scrollbar { display:none; }
.nav ::slotted(a), .nav ::slotted(button) { display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 10px; border-radius:8px;
  color:var(--av-muted); font-weight:500; font-size:13.5px; white-space:nowrap; text-decoration:none; }
.nav ::slotted(a:hover), .nav ::slotted(button:hover) { background:var(--av-soft); color:var(--av-fg); }
.nav ::slotted([aria-current="page"]), .nav ::slotted(.active) { background:var(--av-soft); color:var(--av-fg); font-weight:600;
  box-shadow:inset 0 -2px 0 var(--av-accent); }
.actions { display:flex; align-items:center; gap:6px; }
.iconbtn { width:36px; height:36px; display:grid; place-items:center; border-radius:10px; color:var(--av-muted); }
.iconbtn:hover, .iconbtn[aria-expanded="true"] { background:var(--av-soft); color:var(--av-fg); }
.credits { display:flex; align-items:center; gap:6px; height:30px; padding:0 10px; border:1px solid var(--av-line); border-radius:999px;
  font-family:"JetBrains Mono",ui-monospace,SFMono-Regular,Menlo,monospace; font-size:12.5px; font-variant-numeric:tabular-nums; }
.credits svg { color:var(--av-accent); }
.credits:hover { border-color:var(--av-accent); }
.avatar { width:32px; height:32px; border-radius:50%; display:grid; place-items:center; font-weight:700; font-size:12px; color:#fff;
  background:linear-gradient(135deg,#0EA5E9,#6366F1); }
.signin { height:32px; padding:0 14px; border-radius:8px; background:var(--av-accent); color:#fff; font-weight:600; display:flex; align-items:center; }
.wrap { position:relative; }
.panel { position:absolute; right:0; top:calc(100% + 8px); background:var(--av-bg); border:1px solid var(--av-line); border-radius:14px;
  box-shadow:var(--av-shadow); padding:12px; animation:av-in .14s ease-out; }
.panel[hidden] { display:none; }
@keyframes av-in { from { opacity:0; transform:translateY(-4px); } to { opacity:1; transform:none; } }
@media (prefers-reduced-motion: reduce) { .panel { animation:none; } }
.waffle { width:min(380px, calc(100vw - 24px)); max-height:min(70vh, 560px); overflow:auto; }
.ptitle { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; color:var(--av-muted); margin:6px 6px 8px; }
.grid { display:grid; grid-template-columns:1fr 1fr; gap:6px; margin-bottom:8px; }
.tile { display:flex; flex-direction:column; gap:6px; padding:10px; border-radius:10px; border:1px solid transparent; min-height:84px; position:relative; }
.tile:hover { background:var(--av-soft); border-color:var(--av-line); }
.tile[aria-current="page"] { border-color:var(--av-accent); background:color-mix(in srgb, var(--av-accent) 7%, transparent); }
.tile .ic { width:32px; height:32px; border-radius:9px; display:grid; place-items:center; background:var(--av-soft); color:var(--av-accent-ink); }
.tile .nm { font-weight:600; font-size:13.5px; display:flex; align-items:center; gap:6px; }
.tile .tg { font-size:11.5px; color:var(--av-muted); display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.pill { font-family:"JetBrains Mono",ui-monospace,monospace; font-size:9.5px; font-weight:700; letter-spacing:.06em; padding:2px 6px; border-radius:999px;
  border:1px solid currentColor; line-height:1.4; text-transform:uppercase; }
.pill.beta { color:var(--av-accent); }
.pill.live { color:var(--av-live); }
.pill.maint { color:var(--av-muted); }
.pill.lock { color:var(--av-warn); display:inline-flex; align-items:center; gap:3px; }
.pill.vip { color:var(--av-accent); }
.tile.locked .ic { color:var(--av-muted); }
.badge { position:absolute; top:10px; right:10px; }
.foot { display:flex; justify-content:space-between; align-items:center; border-top:1px solid var(--av-line); padding:10px 6px 2px; margin-top:4px;
  font-size:12.5px; color:var(--av-muted); }
.foot a { color:var(--av-accent-ink); font-weight:600; display:inline-flex; gap:4px; align-items:center; }
.menu { width:260px; padding:6px; }
.who { padding:10px 10px 12px; border-bottom:1px solid var(--av-line); margin-bottom:6px; }
.who .n { font-weight:600; }
.who .e { color:var(--av-muted); font-size:12.5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.who .t { margin-top:8px; display:inline-block; font-family:"JetBrains Mono",ui-monospace,monospace; font-size:10.5px; color:var(--av-accent-ink);
  background:color-mix(in srgb, var(--av-accent) 12%, transparent); padding:2px 8px; border-radius:999px; }
.mi { display:flex; width:100%; text-align:left; padding:9px 10px; border-radius:8px; font-size:13.5px; }
.mi:hover, .mi:focus-visible { background:var(--av-soft); }
.mi.danger { color:#DC2626; }
.warn { margin:0 0 8px; padding:8px 10px; border-radius:8px; font-size:12px; background:color-mix(in srgb, var(--av-warn) 14%, transparent); }
.sr { position:absolute; width:1px; height:1px; overflow:hidden; clip:rect(0 0 0 0); white-space:nowrap; }
@media (max-width: 560px) {
  .current, .brand .word, .sep { display:none; } .credits .lbl { display:none; }
  .applogo img { height:24px; } .nav { margin-left:2px; }
  .brand img { height:20px; } .brand { padding:4px 2px; }
  /* Logos and account on the first line; the app menu gets its own scrollable line below. */
  .bar { flex-wrap:wrap; height:auto; min-height:48px; row-gap:0; padding-top:6px; padding-bottom:4px; }
  .nav { order:10; flex:1 0 100%; margin:2px 0 0; }
  .nav:not(:has(::slotted(*))) { display:none; }
  /* Pin menus to the viewport so they never run off-screen on phones. */
  .panel { position:fixed; left:12px; right:12px; top:56px; width:auto; max-height:calc(100dvh - 72px); overflow:auto; }
}
`;

  let sheet = null;
  function styleFor(root) {
    try {
      if (!sheet) {
        sheet = new CSSStyleSheet();
        sheet.replaceSync(CSS);
      }
      root.adoptedStyleSheets = [sheet];
    } catch {
      root.append(el("style", { text: CSS }));
    }
  }

  // --------------------------------------------------------------- helpers --
  function readCookie(name) {
    for (const part of document.cookie ? document.cookie.split("; ") : []) {
      const i = part.indexOf("=");
      if (part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
    }
    return null;
  }

  function initials(name, email) {
    const parts = String(name || "").trim().split(/\s+/).filter((p) => /^[\p{L}]/u.test(p) && !/^dr\.?$/i.test(p));
    const s = parts.length ? parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : "") : String(email || "?")[0];
    return s.toUpperCase();
  }

  function trustedUrl(raw, homeOrigin) {
    try {
      const u = new URL(raw, homeOrigin);
      const ok = (u.protocol === "https:" && (u.hostname === "altvivo.bio" || u.hostname.endsWith(".altvivo.bio")))
        || u.origin === location.origin || u.origin === homeOrigin;
      return ok ? u.href : null;
    } catch {
      return null;
    }
  }

  const fmt = new Intl.NumberFormat(undefined);

  // ------------------------------------------------------------- element ---
  class AltVivoTopbar extends HTMLElement {
    static get observedAttributes() { return ["app", "theme", "logo"]; }

    constructor() {
      super();
      this._root = this.attachShadow({ mode: "open" });
      styleFor(this._root);
      this._user = null;
      this._apps = [];
      this._open = null; // "apps" | "account" | null
      this._timer = 0;
      this._refreshing = null;
      this._channel = "BroadcastChannel" in window ? new BroadcastChannel(CHANNEL) : null;
      this._onDocClick = (e) => { if (this._open && !e.composedPath().includes(this)) this._close(); };
      this._onKey = (e) => this._keydown(e);
      this._onVisible = () => { if (document.visibilityState === "visible" && this._due()) this.refresh(); };
      this._mql = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
      this._onScheme = () => this._applyTheme();
    }

    get api() { return (this.getAttribute("api") || "https://api.altvivo.bio").replace(/\/$/, ""); }
    get home() { return (this.getAttribute("home") || "https://altvivo.bio").replace(/\/$/, ""); }
    get appId() { return (this.getAttribute("app") || "").toLowerCase(); }
    get user() { return this._user; }
    get apps() { return this._apps.slice(); }

    connectedCallback() {
      this._applyTheme();
      this._mql?.addEventListener?.("change", this._onScheme);
      document.addEventListener("click", this._onDocClick, true);
      document.addEventListener("visibilitychange", this._onVisible);
      this.addEventListener("keydown", this._onKey);
      if (this._channel) this._channel.onmessage = (m) => this._onBroadcast(m.data);
      this._render();
      this._load();
    }

    disconnectedCallback() {
      clearTimeout(this._timer);
      this._mql?.removeEventListener?.("change", this._onScheme);
      document.removeEventListener("click", this._onDocClick, true);
      document.removeEventListener("visibilitychange", this._onVisible);
      this.removeEventListener("keydown", this._onKey);
      if (this._channel) this._channel.onmessage = null;
    }

    attributeChangedCallback() {
      if (this.isConnected) { this._applyTheme(); this._render(); }
    }

    _applyTheme() {
      const t = this.getAttribute("theme") || "auto";
      const dark = t === "dark" || (t === "auto" && this._mql?.matches);
      this.setAttribute("data-theme", dark ? "dark" : "light");
    }

    // --------------------------------------------------------------- data --
    async _load() {
      const [apps] = await Promise.allSettled([this._fetchApps(), this._fetchSession()]);
      if (apps.status === "rejected") this._apps = [];
      this._render();
    }

    async _fetchApps() {
      const r = await fetch(`${this.api}/v1/public/apps`, { credentials: "omit", headers: { Accept: "application/json" } });
      if (!r.ok) throw new Error(`apps ${r.status}`);
      const data = await r.json();
      this._apps = Array.isArray(data.apps) ? data.apps : [];
    }

    async _fetchSession() {
      const r = await fetch(`${this.api}/v1/auth/session`, { credentials: "include", headers: { Accept: "application/json" } });
      if (r.ok) return this._setUser((await r.json()).user);
      if (r.status === 401) return this.refresh();
      if (r.status === 403) {
        // Signed in but blocked (e.g. MFA enrolment pending): show as signed out.
        return this._setUser(null);
      }
    }

    async _csrf() {
      const existing = readCookie("altvivo_csrf");
      if (existing) return existing;
      const r = await fetch(`${this.api}/v1/auth/csrf`, { credentials: "include" });
      if (!r.ok) throw new Error("csrf");
      return (await r.json()).csrfToken;
    }

    /** Rotates the session (refresh cookie) and re-reads the profile. */
    refresh() {
      if (this._refreshing) return this._refreshing;
      this._refreshing = (async () => {
        try {
          const r = await fetch(`${this.api}/v1/auth/refresh`, {
            method: "POST",
            credentials: "include",
            headers: { "X-CSRF-Token": await this._csrf(), Accept: "application/json" },
          });
          if (!r.ok) throw new Error(`refresh ${r.status}`);
          this._setUser((await r.json()).user);
          this._channel?.postMessage({ type: "refreshed" });
        } catch {
          this._setUser(null);
        } finally {
          this._refreshing = null;
          this._render();
        }
      })();
      return this._refreshing;
    }

    async signOut() {
      try {
        await fetch(`${this.api}/v1/auth/logout`, {
          method: "POST",
          credentials: "include",
          headers: { "X-CSRF-Token": await this._csrf() },
        });
      } catch {
        /* the redirect below still ends the local view of the session */
      }
      this._channel?.postMessage({ type: "signedout" });
      this._setUser(null);
      location.assign(`${this.home}/`);
    }

    _setUser(user) {
      const was = this._user;
      this._user = user && typeof user === "object" ? user : null;
      clearTimeout(this._timer);
      if (this._user) {
        const exp = Date.parse(this._user.accessTokenExpiresAt || "");
        if (Number.isFinite(exp)) {
          const wait = Math.max(10_000, exp - Date.now() - 60_000);
          this._timer = setTimeout(() => this.refresh(), Math.min(wait, 2_147_000_000));
        }
        this.dispatchEvent(new CustomEvent("altvivo:session", { detail: { user: this._user }, bubbles: true, composed: true }));
      } else if (was) {
        this.dispatchEvent(new CustomEvent("altvivo:signedout", { bubbles: true, composed: true }));
      }
      this._render();
    }

    _due() {
      const exp = Date.parse(this._user?.accessTokenExpiresAt || "");
      return !Number.isFinite(exp) || exp - Date.now() < 60_000;
    }

    _onBroadcast(msg) {
      if (!msg || typeof msg !== "object") return;
      if (msg.type === "signedout") this._setUser(null);
      if (msg.type === "refreshed") this._fetchSession().catch(() => {});
    }

    // ------------------------------------------------------------- render --
    _render() {
      const root = this._root;
      for (const n of [...root.childNodes]) if (n.nodeName !== "STYLE") n.remove();
      const current = this._apps.find((a) => a.appId === this.appId);
      const bar = el("header", { class: "bar", part: "bar", role: "banner", "aria-label": "AltVivo" });

      const brand = el("a", { class: "brand", href: `${this.home}/`, title: "AltVivo home" });
      if (LOGOS["wordmark-light"]) {
        // The original AltVivo logo with its name, on every screen size.
        for (const [cls, key] of [["wm lt", "wordmark-light"], ["wm dk", "wordmark-dark"]]) {
          brand.append(el("img", { class: cls, src: LOGOS[key], alt: "", "aria-hidden": "true", draggable: "false" }));
        }
        brand.append(el("span", { class: "sr", text: "AltVivo" }));
      } else {
        brand.append(el("span", { class: "mark" }, icon("zap", 14)), el("span", { class: "word", text: "AltVivo" }));
      }
      bar.append(brand);
      // The app's own logo (brand slot), else the logo attribute, else its name.
      // Relative logo paths belong to the app's own site, not to altvivo.bio.
      const logo = this.getAttribute("logo") ? trustedUrl(this.getAttribute("logo"), location.href) : null;
      const name = current?.name || "";
      const fallback = logo
        ? el("a", { class: "applogo", href: "/", title: `${name || "App"} home` }, el("img", { src: logo, alt: name || "App" }))
        : name ? el("span", { class: "current", text: name }) : null;
      const brandSlot = el("slot", { name: "brand" });
      if (fallback) brandSlot.append(fallback);
      bar.append(el("span", { class: "sep", "aria-hidden": "true" }), brandSlot);
      // The app's menu (default slot) takes the free space; empty, it is just a spacer.
      bar.append(el("nav", { class: "nav", "aria-label": `${name || "App"} menu`, part: "nav" }, el("slot")));
      bar.append(el("span", { class: "actions", part: "actions" }, el("slot", { name: "actions" })));

      if (this._user) {
        const credits = el("a", {
          class: "credits", href: `${this.home}/workspace/billing`,
          title: "Compute credits remaining", "aria-label": `${fmt.format(this._user.creditsRemaining ?? 0)} compute credits remaining`,
        }, icon("zap", 14), el("span", { text: fmt.format(this._user.creditsRemaining ?? 0) }), el("span", { class: "lbl", text: "credits" }));
        bar.append(credits);
      }

      // Waffle
      const appsWrap = el("div", { class: "wrap" });
      const appsBtn = el("button", {
        class: "iconbtn", type: "button", "aria-haspopup": "dialog", "aria-expanded": this._open === "apps" ? "true" : "false",
        "aria-controls": "av-apps", title: "AltVivo apps",
      }, icon("grid", 18), el("span", { class: "sr", text: "Switch AltVivo app" }));
      appsBtn.addEventListener("click", () => this._toggle("apps"));
      appsWrap.append(appsBtn, this._appsPanel());
      bar.append(appsWrap);

      if (this._user) {
        const accWrap = el("div", { class: "wrap" });
        const accBtn = el("button", {
          class: "iconbtn", type: "button", "aria-haspopup": "menu", "aria-expanded": this._open === "account" ? "true" : "false",
          "aria-controls": "av-account", title: this._user.name || "Account",
        }, el("span", { class: "avatar", "aria-hidden": "true", text: initials(this._user.name, this._user.email) }),
          el("span", { class: "sr", text: `Account menu for ${this._user.name || this._user.email}` }));
        accBtn.addEventListener("click", () => this._toggle("account"));
        accWrap.append(accBtn, this._accountMenu());
        bar.append(accWrap);
      } else {
        const next = encodeURIComponent(location.href);
        bar.append(el("a", { class: "signin", href: `${this.home}/login?next=${next}`, text: "Sign in" }));
      }
      root.append(bar);
    }

    _appsPanel() {
      const panel = el("div", { class: "panel waffle", id: "av-apps", role: "dialog", "aria-label": "AltVivo apps", hidden: this._open !== "apps" });
      const ents = this._user?.entitlements || {};
      const live = this._apps.filter((a) => a.status === "LIVE" || a.status === "BETA" || a.status === "MAINTENANCE");
      if (!this._apps.length) panel.append(el("p", { class: "warn", text: "Apps are unavailable right now. Please retry shortly." }));

      const section = (title, list) => {
        if (!list.length) return;
        panel.append(el("p", { class: "ptitle", text: title }));
        const grid = el("div", { class: "grid", role: "list" });
        for (const a of list) {
          const isCurrent = a.appId === this.appId;
          const licence = this._licence(a.appId, ents);
          const locked = this._user && licence === "locked";
          // Locked apps go straight to the upgrade page instead of bouncing off the paid gate.
          const href = locked ? this._upgradeUrl(a.appId) : trustedUrl(a.url, this.home);
          const tile = el(href ? "a" : "div", {
            class: `tile${locked ? " locked" : ""}`, role: "listitem", href: href || undefined,
            "aria-current": isCurrent ? "page" : undefined,
            "aria-label": `${a.name}${locked ? ", locked, upgrade required" : ""}${isCurrent ? ", current app" : ""}`,
          });
          tile.append(el("span", { class: "ic" }, icon(a.iconKey, 18)));
          const name = el("span", { class: "nm", text: a.name });
          if (a.status === "BETA") name.append(el("span", { class: "pill beta", text: "Beta" }));
          tile.append(name, el("span", { class: "tg", text: a.tagline || "" }));
          let badge = null;
          if (a.status === "MAINTENANCE") badge = el("span", { class: "pill maint", text: "Maint." });
          else if (this._user && licence === "vip") badge = el("span", { class: "pill vip", text: "VIP" });
          else if (this._user && licence === "licensed") badge = el("span", { class: "pill live", text: "Licensed" });
          else if (this._user) badge = el("span", { class: "pill lock" }, icon("lock", 10), document.createTextNode("Locked"));
          if (badge) tile.append(el("span", { class: "badge" }, badge));
          grid.append(tile);
        }
        panel.append(grid);
      };
      section("Applications", live);
      const foot = el("div", { class: "foot" }, el("span", { text: `v${VERSION}` }),
        el("a", { href: `${this.home}/workspace` }, document.createTextNode("Open workspace"), icon("external", 13)));
      panel.append(foot);
      return panel;
    }

    /** "vip" | "licensed" | "locked" from the session's paid entitlements. */
    _licence(appId, ents) {
      if (VIP_ROLES.has(this._user?.role)) return "vip";
      const e = ents[appId];
      if (!e || typeof e !== "object" || e.active !== true) return "locked";
      const exp = e.expiresAt ? Date.parse(e.expiresAt) : NaN;
      return Number.isFinite(exp) && exp <= Date.now() ? "locked" : "licensed";
    }

    _upgradeUrl(appId) {
      return `${this.home}/workspace/upgrade?app=${encodeURIComponent(appId)}&reason=subscription_required`;
    }

    _accountMenu() {
      const u = this._user;
      const menu = el("div", { class: "panel menu", id: "av-account", role: "menu", "aria-label": "Account", hidden: this._open !== "account" });
      const who = el("div", { class: "who", role: "presentation" },
        el("div", { class: "n", text: u.name || "AltVivo user" }), el("div", { class: "e", text: u.email || "" }));
      if (u.tier) who.append(el("span", { class: "t", text: String(u.tier).replace(/_/g, " ") }));
      menu.append(who);
      if (u.emailVerified === false) menu.append(el("p", { class: "warn", text: "Verify your email to unlock trial access." }));
      const item = (label, href) => el("a", { class: "mi", role: "menuitem", href, tabindex: "-1", text: label });
      menu.append(item("Workspace", `${this.home}/workspace`), item("Account & security", `${this.home}/workspace/security`),
        item("Billing & credits", `${this.home}/workspace/billing`));
      const out = el("button", { class: "mi danger", role: "menuitem", type: "button", tabindex: "-1", text: "Sign out" });
      out.addEventListener("click", () => this.signOut());
      menu.append(out);
      return menu;
    }

    // -------------------------------------------------------- interaction --
    _toggle(which) {
      this._open = this._open === which ? null : which;
      this._render();
      if (this._open) {
        const panel = this._root.getElementById(this._open === "apps" ? "av-apps" : "av-account");
        const first = panel?.querySelector("a[href], button");
        first?.focus();
      }
    }

    _close(returnFocus = false) {
      const was = this._open;
      this._open = null;
      this._render();
      if (returnFocus && was) {
        const btn = this._root.querySelector(`[aria-controls="${was === "apps" ? "av-apps" : "av-account"}"]`);
        btn?.focus();
      }
    }

    _keydown(e) {
      if (!this._open) return;
      if (e.key === "Escape") {
        e.preventDefault();
        this._close(true);
        return;
      }
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
      const panel = this._root.getElementById(this._open === "apps" ? "av-apps" : "av-account");
      const items = [...(panel?.querySelectorAll("a[href], button") || [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(this._root.activeElement);
      const n = e.key === "Home" ? 0 : e.key === "End" ? items.length - 1
        : (i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length;
      items[n].focus();
    }
  }

  customElements.define("altvivo-topbar", AltVivoTopbar);
})();
