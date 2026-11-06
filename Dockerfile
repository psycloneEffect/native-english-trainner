# ローカルの開発と検証にだけ使うイメージ。本番は Cloudflare Workers で動くので使わない。
# ソースと .dev.vars はイメージに含めず、compose.yaml のマウントで渡す。
# 秘密情報がイメージレイヤーに残らないように、COPY は使わない。

# CI と同じ Node のメジャーバージョンにそろえる（.github/workflows/ci.yml）。
# wrangler が使う workerd は glibc 向けなので、musl の Alpine は使えない。
FROM node:22-slim

# slim には CA 証明書が入っておらず、Worker から HTTPS で通信するときに検証で使うので入れる
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# package.json を置かない方針なので、wrangler はイメージにだけ入れる
RUN npm install --global wrangler@4 \
  && npm cache clean --force

# 利用状況の送信は開発に不要なので止める
ENV WRANGLER_SEND_METRICS=false

# 名前付きボリュームは初回にマウント先の所有者を引き継ぐので、
# root 以外でも書き込めるように .wrangler をここで作っておく
WORKDIR /app
RUN mkdir -p /app/.wrangler && chown -R node:node /app
USER node

EXPOSE 8787

# コンテナの外から届くように、全インターフェースで待ち受ける。
# 公開範囲は compose.yaml のポート設定で 127.0.0.1 に絞っている。
CMD ["wrangler", "dev", "--ip", "0.0.0.0", "--port", "8787"]
