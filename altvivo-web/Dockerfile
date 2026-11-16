FROM node:22-alpine
WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Public settings passed by docker-compose (build.args). Next.js inlines
# NEXT_PUBLIC_* values at build time, so each one must be declared here or
# Docker silently drops it. The URL fallbacks live in src/lib/config.ts.
ARG NEXT_PUBLIC_API_URL
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_EMBED_URL
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ARG NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
ARG NEXT_PUBLIC_RAZORPAY_KEY_ID

# Copy source and build
COPY . .
# Disable telemetry to speed up build
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# Expose port and start
EXPOSE 3000
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"

CMD ["npm", "start"]
