// Sequelize CLI config — reads the same .env the app uses.
require('dotenv').config();

const common = {
  username: process.env.DATABASE_USER,
  password: process.env.DATABASE_PASSWORD,
  database: process.env.DATABASE_NAME,
  host: process.env.DATABASE_HOST,
  port: Number(process.env.DATABASE_PORT || 5432),
  dialect: 'postgres',
  logging: process.env.DATABASE_LOGGING === 'true' ? console.log : false,
  dialectOptions:
    process.env.DATABASE_SSL === 'true'
      ? { ssl: { require: true, rejectUnauthorized: false } }
      : {},
};

module.exports = {
  development: common,
  test: common,
  production: common,
};
