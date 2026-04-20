const mongoose = require("mongoose");
const { env } = require("./env");
const logger = require("./logger");

async function connectDatabase() {
  mongoose.connection.on("connected", () => {
    logger.info("MongoDB connected");
  });

  mongoose.connection.on("error", (error) => {
    logger.error("MongoDB connection error", error);
  });

  await mongoose.connect(env.MONGODB_URI);
}

module.exports = connectDatabase;
