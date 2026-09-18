using 'main.bicep'

// Secrets are read from environment variables at deploy time so nothing
// sensitive is ever committed. Set these before deploying:
//   $env:PG_ADMIN_PASSWORD = '...'
//   $env:CLERK_SECRET_KEY = '...'
//   $env:AGENT_API_KEY = '...'   (a Groq key, or any OpenAI-compatible provider key)
//   az deployment group create --resource-group <rg> --parameters main.bicepparam

param namePrefix = 'fedimg'
param environmentName = 'dev'
param postgresAdminLogin = 'fedimg_admin'
param clerkPublishableKey = 'pk_test_replace_me'
param postgresAdminPassword = readEnvironmentVariable('PG_ADMIN_PASSWORD')
param clerkSecretKey = readEnvironmentVariable('CLERK_SECRET_KEY')
param agentApiKey = readEnvironmentVariable('AGENT_API_KEY')
