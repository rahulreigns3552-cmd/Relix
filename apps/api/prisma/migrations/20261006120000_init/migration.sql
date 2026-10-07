-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'user',
    "displayName" TEXT NOT NULL DEFAULT 'Relix',
    "emailNotifications" BOOLEAN NOT NULL DEFAULT true,
    "pushNotifications" BOOLEAN NOT NULL DEFAULT false,
    "weeklyDigest" BOOLEAN NOT NULL DEFAULT true,
    "confirmBeforeProceed" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "website" TEXT NOT NULL DEFAULT '',
    "industry" TEXT NOT NULL DEFAULT '',
    "ownerEmail" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectDoc" (
    "projectId" TEXT NOT NULL,
    "docKey" TEXT NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "ProjectDoc_pkey" PRIMARY KEY ("projectId","docKey")
);

-- CreateTable
CREATE TABLE "ProvisionJob" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "projectId" TEXT,
    "email" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "body" JSONB NOT NULL,

    CONSTRAINT "ProvisionJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelJob" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "platform" TEXT,
    "status" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "body" JSONB NOT NULL,

    CONSTRAINT "ChannelJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BridgeSetting" (
    "id" INTEGER NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "BridgeSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppDocument" (
    "docKey" TEXT NOT NULL,
    "body" JSONB NOT NULL,

    CONSTRAINT "AppDocument_pkey" PRIMARY KEY ("docKey")
);

-- CreateTable
CREATE TABLE "ChatLead" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "exchangeKey" TEXT NOT NULL,
    "createdAt" TEXT NOT NULL,
    "toEmail" TEXT NOT NULL,
    "emailedAt" TEXT,
    "transcript" JSONB NOT NULL,

    CONSTRAINT "ChatLead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "ChatLead_exchangeKey_key" ON "ChatLead"("exchangeKey");

-- CreateIndex
CREATE INDEX "ChatLead_emailedAt_createdAt_idx" ON "ChatLead"("emailedAt", "createdAt");

-- AddForeignKey
ALTER TABLE "ProjectDoc" ADD CONSTRAINT "ProjectDoc_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
