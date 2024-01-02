-- CreateTable
CREATE TABLE "PostgreSQL" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "port" INTEGER NOT NULL,
    "host" TEXT NOT NULL,
    "database" TEXT NOT NULL,
    "user" TEXT NOT NULL,
    "password" TEXT NOT NULL
);
