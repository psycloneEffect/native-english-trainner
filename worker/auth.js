/**
 * 利用者の識別とアクセス制御。
 *
 * 実際の防御線は Cloudflare Access のポリシー側にある。
 * ここは設定漏れの検知のみで、JWTの署名検証はしていない。
 *
 * 既知の制約: 静的アセットを同梱した Worker は内部のルーター経由で実行されるため、
 * Access が cf-access-jwt-assertion を渡さない場合がある。
 * そのため REQUIRE_ACCESS を "true" にすると認証済みでも弾かれうる。
 * 利用者単位のトークン制限を入れる際は、この識別手段から設計し直すこと。
 */

/** 通過すれば null、拒否するならエラーコードを返す。 */
export function checkAccess(request, env) {
  if (env.REQUIRE_ACCESS !== "true") return null;
  return request.headers.get("cf-access-jwt-assertion") ? null : "unauthorized";
}
