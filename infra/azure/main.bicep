// Federated Imaging Network — Azure infrastructure
//
// Deploys the coordinator API and web dashboard as Container Apps behind a
// shared Container Apps Environment, backed by Postgres Flexible Server,
// Key Vault for secrets, and Container Registry for images. Scoped to a
// single pilot environment (e.g. 10 hospital sites); split into separate
// resource groups per environment (dev/staging/prod) rather than adding
// environment branching inside this template.
//
// Deploy with:
//   az deployment group create \
//     --resource-group <rg> \
//     --template-file main.bicep \
//     --parameters main.bicepparam
//
// First deployment: leave apiContainerImage/webContainerImage at their
// placeholder defaults (the registry is empty until CI pushes an image).
// Re-run the deployment, or update the Container Apps directly via
// `az containerapp update --image ...`, once the first images are pushed.

targetScope = 'resourceGroup'

@description('Short name used as a prefix for all resource names, e.g. "fedimg".')
@minLength(3)
@maxLength(12)
param namePrefix string = 'fedimg'

@description('Deployment environment name, used for tagging and Container Apps environment naming.')
@allowed(['dev', 'staging', 'prod'])
param environmentName string = 'dev'

@description('Azure region for all resources.')
param location string = resourceGroup().location

@description('Administrator login for the Postgres Flexible Server.')
param postgresAdminLogin string = 'fedimg_admin'

@description('Administrator password for the Postgres Flexible Server.')
@secure()
param postgresAdminPassword string

@description('Clerk secret key used by the API server to verify sessions.')
@secure()
param clerkSecretKey string

@description('Clerk publishable key, safe to expose to the browser build.')
param clerkPublishableKey string

@description('API key for the Federation Agent\'s model provider (an OpenAI-compatible endpoint, e.g. Groq).')
@secure()
param agentApiKey string

@description('Base URL of the OpenAI-compatible chat completions API the agent calls.')
param agentBaseUrl string = 'https://api.groq.com/openai/v1'

@description('Model name to request from the agent\'s provider.')
param agentModel string = 'openai/gpt-oss-120b'

@description('Container image for the coordinator API. Update after the first CI push to ACR.')
param apiContainerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('Container image for the web dashboard. Update after the first CI push to ACR.')
param webContainerImage string = 'mcr.microsoft.com/k8se/quickstart:latest'

@description('vCPU allocated to each container app replica.')
param containerCpu string = '0.5'

@description('Memory allocated to each container app replica.')
param containerMemory string = '1Gi'

var resourceToken = '${namePrefix}${environmentName}'
var tags = {
  project: 'federated-imaging-network'
  environment: environmentName
}

resource logAnalytics 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: '${resourceToken}-logs'
  location: location
  tags: tags
  properties: {
    sku: {
      name: 'PerGB2018'
    }
    retentionInDays: 30
  }
}

resource appInsights 'Microsoft.Insights/components@2020-02-02' = {
  name: '${resourceToken}-ai'
  location: location
  tags: tags
  kind: 'web'
  properties: {
    Application_Type: 'web'
    WorkspaceResourceId: logAnalytics.id
    IngestionMode: 'LogAnalytics'
  }
}

resource containerRegistry 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: '${resourceToken}acr'
  location: location
  tags: tags
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: false
  }
}

resource appIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: '${resourceToken}-identity'
  location: location
  tags: tags
}

var acrPullRoleId = '7f951dda-4ed3-4680-a7ca-43fe172d538d'
resource acrPullAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(containerRegistry.id, appIdentity.id, acrPullRoleId)
  scope: containerRegistry
  properties: {
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', acrPullRoleId)
  }
}

resource keyVault 'Microsoft.KeyVault/vaults@2023-07-01' = {
  name: '${resourceToken}-kv'
  location: location
  tags: tags
  properties: {
    sku: {
      family: 'A'
      name: 'standard'
    }
    tenantId: subscription().tenantId
    enableRbacAuthorization: true
    enableSoftDelete: true
    softDeleteRetentionInDays: 90
    enablePurgeProtection: true
  }
}

var keyVaultSecretsUserRoleId = '4633458b-17de-408a-b874-0445c86b69e6'
resource keyVaultSecretsUserAssignment 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(keyVault.id, appIdentity.id, keyVaultSecretsUserRoleId)
  scope: keyVault
  properties: {
    principalId: appIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', keyVaultSecretsUserRoleId)
  }
}

resource postgresPasswordSecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'postgres-admin-password'
  properties: {
    value: postgresAdminPassword
  }
}

resource clerkSecretKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'clerk-secret-key'
  properties: {
    value: clerkSecretKey
  }
}

resource agentApiKeySecret 'Microsoft.KeyVault/vaults/secrets@2023-07-01' = {
  parent: keyVault
  name: 'agent-api-key'
  properties: {
    value: agentApiKey
  }
}

resource postgres 'Microsoft.DBforPostgreSQL/flexibleServers@2023-06-01-preview' = {
  name: '${resourceToken}-pg'
  location: location
  tags: tags
  sku: {
    name: 'Standard_B1ms'
    tier: 'Burstable'
  }
  properties: {
    version: '16'
    administratorLogin: postgresAdminLogin
    administratorLoginPassword: postgresAdminPassword
    storage: {
      storageSizeGB: 32
    }
    backup: {
      backupRetentionDays: 7
      geoRedundantBackup: 'Disabled'
    }
    highAvailability: {
      mode: 'Disabled'
    }
  }
}

resource postgresDatabase 'Microsoft.DBforPostgreSQL/flexibleServers/databases@2023-06-01-preview' = {
  parent: postgres
  name: 'federation'
  properties: {
    charset: 'UTF8'
    collation: 'en_US.utf8'
  }
}

resource postgresAllowAzureServices 'Microsoft.DBforPostgreSQL/flexibleServers/firewallRules@2023-06-01-preview' = {
  parent: postgres
  name: 'AllowAzureServices'
  properties: {
    startIpAddress: '0.0.0.0'
    endIpAddress: '0.0.0.0'
  }
}

resource containerAppsEnvironment 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: '${resourceToken}-env'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: {
        customerId: logAnalytics.properties.customerId
        sharedKey: logAnalytics.listKeys().primarySharedKey
      }
    }
  }
}

resource apiContainerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${resourceToken}-api'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: appIdentity.id
        }
      ]
      secrets: [
        {
          name: 'clerk-secret-key'
          keyVaultUrl: clerkSecretKeySecret.properties.secretUri
          identity: appIdentity.id
        }
        {
          name: 'postgres-admin-password'
          keyVaultUrl: postgresPasswordSecret.properties.secretUri
          identity: appIdentity.id
        }
        {
          name: 'agent-api-key'
          keyVaultUrl: agentApiKeySecret.properties.secretUri
          identity: appIdentity.id
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'api-server'
          image: apiContainerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
          env: [
            { name: 'PORT', value: '8080' }
            { name: 'NODE_ENV', value: 'production' }
            { name: 'CLERK_SECRET_KEY', secretRef: 'clerk-secret-key' }
            { name: 'CLERK_PUBLISHABLE_KEY', value: clerkPublishableKey }
            {
              name: 'DATABASE_URL'
              value: 'postgresql://${postgresAdminLogin}@${postgres.properties.fullyQualifiedDomainName}:5432/federation?sslmode=require'
            }
            { name: 'PGPASSWORD', secretRef: 'postgres-admin-password' }
            { name: 'GROQ_API_KEY', secretRef: 'agent-api-key' }
            { name: 'GROQ_BASE_URL', value: agentBaseUrl }
            { name: 'AGENT_MODEL', value: agentModel }
            { name: 'APPLICATIONINSIGHTS_CONNECTION_STRING', value: appInsights.properties.ConnectionString }
          ]
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    acrPullAssignment
    keyVaultSecretsUserAssignment
  ]
}

resource webContainerApp 'Microsoft.App/containerApps@2024-03-01' = {
  name: '${resourceToken}-web'
  location: location
  tags: tags
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${appIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: containerAppsEnvironment.id
    configuration: {
      activeRevisionsMode: 'Single'
      registries: [
        {
          server: containerRegistry.properties.loginServer
          identity: appIdentity.id
        }
      ]
      ingress: {
        external: true
        targetPort: 8080
        transport: 'auto'
      }
    }
    template: {
      containers: [
        {
          name: 'web'
          image: webContainerImage
          resources: {
            cpu: json(containerCpu)
            memory: containerMemory
          }
        }
      ]
      scale: {
        minReplicas: 1
        maxReplicas: 3
      }
    }
  }
  dependsOn: [
    acrPullAssignment
  ]
}

@description('Public URL of the coordinator API.')
output apiUrl string = 'https://${apiContainerApp.properties.configuration.ingress.fqdn}'

@description('Public URL of the web dashboard.')
output webUrl string = 'https://${webContainerApp.properties.configuration.ingress.fqdn}'

@description('Login server for the container registry, used by CI to push images.')
output registryLoginServer string = containerRegistry.properties.loginServer

@description('Fully qualified domain name of the Postgres Flexible Server.')
output postgresFqdn string = postgres.properties.fullyQualifiedDomainName

@description('URI of the Key Vault holding deployment secrets.')
output keyVaultUri string = keyVault.properties.vaultUri

@description('Resource ID of the user-assigned identity CI should use to push images / update revisions.')
output appIdentityId string = appIdentity.id
