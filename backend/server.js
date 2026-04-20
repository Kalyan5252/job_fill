require("dotenv").config();

const app = require("./src/app");
const connectDatabase = require("./src/config/db");
const { env } = require("./src/config/env");
const logger = require("./src/config/logger");

async function bootstrap() {
  try {
    await connectDatabase();
    app.listen(env.PORT, () => {
      logger.info(`API server listening on port ${env.PORT}`);
    });
  } catch (error) {
    logger.error("Failed to bootstrap server", error);
    process.exit(1);
  }
}

bootstrap();
