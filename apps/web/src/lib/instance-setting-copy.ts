import { getCurrentLocale } from '$lib/i18n';

interface SettingCopyInput {
	key: string;
	label: string;
	description: string;
}

interface SettingCopy {
	label: string;
	description: string;
}

// The registry is supplied by the API so operators can add settings without a
// frontend schema change. Keep the Portuguese copy keyed by the stable setting
// name and fall back to the server copy for new or English settings.
const portugueseCopyDefinitions = {
	OPENPOST_DISABLE_REGISTRATIONS: {
		label: 'Desativar novos registos',
		description:
			'Impede novos registos por palavra-passe e fornecedor de identidade sem afetar utilizadores existentes.'
	},
	OPENPOST_LEGAL_ACCEPTANCE_REQUIRED: {
		label: 'Exigir aceitação legal',
		description:
			'Exige que os utilizadores aceitem as versões configuradas dos termos e da política de privacidade.'
	},
	OPENPOST_TERMS_URL: {
		label: 'URL dos termos',
		description: 'URL público dos termos de serviço.'
	},
	OPENPOST_PRIVACY_URL: {
		label: 'URL de privacidade',
		description: 'URL público da política de privacidade.'
	},
	OPENPOST_TERMS_VERSION: {
		label: 'Versão dos termos',
		description: 'Versão registada quando um utilizador aceita os termos.'
	},
	OPENPOST_PRIVACY_VERSION: {
		label: 'Versão de privacidade',
		description: 'Versão registada quando um utilizador aceita a política de privacidade.'
	},
	OPENPOST_SUPPORT_EMAIL: {
		label: 'Email de suporte',
		description: 'Endereço de contacto mostrado nos fluxos de conta e políticas.'
	},
	OPENPOST_UPDATE_CHECK_ENABLED: {
		label: 'Verificação de versões',
		description: 'Procura novas versões estáveis do OpenPost nas definições da instância.'
	},
	OPENPOST_PADDLE_API_KEY: {
		label: 'Chave API da Paddle',
		description:
			'Chave secreta usada para reconciliar clientes e subscrições e criar sessões do portal.'
	},
	OPENPOST_PADDLE_ENVIRONMENT: {
		label: 'Ambiente da Paddle',
		description: 'Define explicitamente sandbox para testes ou production para faturação real.'
	},
	OPENPOST_PADDLE_CLIENT_TOKEN: {
		label: 'Token de cliente da Paddle',
		description: 'Token público usado pelo Paddle.js no checkout e nas pré-visualizações de preços.'
	},
	OPENPOST_PADDLE_WEBHOOK_SECRET: {
		label: 'Segredo do webhook da Paddle',
		description: 'Segredo usado para verificar o corpo original dos eventos enviados pela Paddle.'
	},
	OPENPOST_PADDLE_CHECKOUT_RETURN_URL: {
		label: 'URL de retorno do checkout',
		description: 'URL do OpenPost mostrada quando o checkout da Paddle termina.'
	},
	OPENPOST_PADDLE_STARTER_MONTHLY_PRICE_ID: {
		label: 'ID do preço mensal Starter',
		description: 'Preço Paddle usado nas subscrições mensais Starter.'
	},
	OPENPOST_PADDLE_STARTER_ANNUAL_PRICE_ID: {
		label: 'ID do preço anual Starter',
		description: 'Preço Paddle usado nas subscrições anuais Starter.'
	},
	OPENPOST_PADDLE_FOUNDER_MONTHLY_PRICE_ID: {
		label: 'ID do preço mensal Founder',
		description: 'Preço Paddle usado nas subscrições mensais Founder.'
	},
	OPENPOST_PADDLE_FOUNDER_ANNUAL_PRICE_ID: {
		label: 'ID do preço anual Founder',
		description: 'Preço Paddle usado nas subscrições anuais Founder.'
	},
	OPENPOST_PADDLE_PRO_MONTHLY_PRICE_ID: {
		label: 'ID do preço mensal Pro',
		description: 'Preço Paddle usado nas subscrições mensais Pro.'
	},
	OPENPOST_PADDLE_PRO_ANNUAL_PRICE_ID: {
		label: 'ID do preço anual Pro',
		description: 'Preço Paddle usado nas subscrições anuais Pro.'
	},
	OPENPOST_PADDLE_TEAM_MONTHLY_PRICE_ID: {
		label: 'ID do preço mensal Team',
		description: 'Preço Paddle usado nas subscrições mensais Team.'
	},
	OPENPOST_PADDLE_TEAM_ANNUAL_PRICE_ID: {
		label: 'ID do preço anual Team',
		description: 'Preço Paddle usado nas subscrições anuais Team.'
	},
	OPENPOST_PADDLE_AGENCY_MONTHLY_PRICE_ID: {
		label: 'ID do preço mensal Agency',
		description: 'Preço Paddle usado nas subscrições mensais Agency.'
	},
	OPENPOST_PADDLE_AGENCY_ANNUAL_PRICE_ID: {
		label: 'ID do preço anual Agency',
		description: 'Preço Paddle usado nas subscrições anuais Agency.'
	},
	OPENPOST_EMAIL_VERIFICATION_REQUIRED: {
		label: 'Exigir verificação de email',
		description:
			'Exige um código de seis dígitos por email antes de uma conta com palavra-passe poder iniciar sessão.'
	},
	OPENPOST_EMAIL_PROVIDER: {
		label: 'Fornecedor de email',
		description: 'Serviço de envio das mensagens de verificação e recuperação de palavra-passe.'
	},
	OPENPOST_EMAIL_FROM: {
		label: 'Endereço do remetente',
		description: 'Remetente usado nas mensagens de autenticação.'
	},
	OPENPOST_RESEND_API_KEY: {
		label: 'Chave API da Resend',
		description: 'Chave API usada apenas quando a Resend está selecionada.'
	},
	OPENPOST_CLOUDFLARE_EMAIL_ACCOUNT_ID: {
		label: 'ID da conta Cloudflare',
		description: 'Conta Cloudflare que detém o serviço de envio de email.'
	},
	OPENPOST_CLOUDFLARE_EMAIL_API_TOKEN: {
		label: 'Token API da Cloudflare',
		description: 'Token restrito usado apenas para enviar mensagens de autenticação.'
	},
	OPENPOST_SMTP_HOST: { label: 'Servidor SMTP', description: 'Nome do servidor SMTP.' },
	OPENPOST_SMTP_PORT: {
		label: 'Porta SMTP',
		description: 'Porta usada para ligar ao servidor SMTP.'
	},
	OPENPOST_SMTP_USERNAME: {
		label: 'Utilizador SMTP',
		description: 'Utilizador opcional para autenticação SMTP.'
	},
	OPENPOST_SMTP_PASSWORD: {
		label: 'Palavra-passe SMTP',
		description: 'Palavra-passe usada quando o servidor SMTP exige autenticação.'
	},
	OPENPOST_SMTP_TLS_MODE: {
		label: 'Modo TLS de SMTP',
		description: 'Segurança de transporte usada na ligação SMTP.'
	},
	OPENPOST_SMTP_SERVER_NAME: {
		label: 'Nome TLS do servidor SMTP',
		description: 'Nome TLS opcional usado para verificar o certificado.'
	},
	OPENPOST_AUTH_GOOGLE_CLIENT_ID: {
		label: 'ID de cliente Google',
		description: 'ID de cliente OAuth para iniciar sessão e associar contas Google.'
	},
	OPENPOST_AUTH_GOOGLE_CLIENT_SECRET: {
		label: 'Segredo de cliente Google',
		description: 'Segredo de cliente OAuth para iniciar sessão e associar contas Google.'
	},
	OPENPOST_OIDC_ISSUER: {
		label: 'Emissor OIDC',
		description: 'URL do emissor do fornecedor OpenID Connect gerido pelo operador.'
	},
	OPENPOST_OIDC_CLIENT_ID: {
		label: 'ID de cliente OIDC',
		description: 'ID de cliente do fornecedor OpenID Connect gerido pelo operador.'
	},
	OPENPOST_OIDC_CLIENT_SECRET: {
		label: 'Segredo de cliente OIDC',
		description: 'Segredo de cliente do fornecedor OpenID Connect gerido pelo operador.'
	},
	OPENPOST_OIDC_NAME: {
		label: 'Nome do OIDC',
		description: 'Nome do fornecedor de identidade mostrado aos utilizadores.'
	},
	OPENPOST_OIDC_SCOPES: {
		label: 'Âmbitos OIDC',
		description: 'Âmbitos OpenID Connect separados por espaços ou vírgulas.'
	},
	OPENPOST_OIDC_JIT_ENABLED: {
		label: 'Utilizadores OIDC automáticos',
		description: 'Permite ao fornecedor OIDC criar um utilizador no primeiro início de sessão.'
	},
	OPENPOST_OIDC_BOOTSTRAP_ALLOWLIST: {
		label: 'Sujeitos OIDC iniciais',
		description: 'Identificadores autorizados a iniciar a administração do SSO da organização.'
	},
	OPENPOST_SSO_BREAK_GLASS_EMAILS: {
		label: 'Emails de emergência do SSO',
		description: 'Contas que mantêm acesso direto se o SSO da organização estiver indisponível.'
	},
	OPENPOST_OIDC_NATIVE_CALLBACK_URL: {
		label: 'Retorno OIDC nativo',
		description: 'URI de retorno usada pelos clientes nativos do OpenPost.'
	},
	OPENPOST_IMAGE_EDITOR_ENABLED: {
		label: 'Editor de Imagens OpenPost',
		description: 'Ativa o espaço de design e os respetivos modelos.'
	},
	OPENPOST_IMAGE_EDITOR_MODEL_BASE_URL: {
		label: 'Caminho dos modelos de design',
		description:
			'URL ou caminho da aplicação usado para carregar os modelos do Editor de Imagens OpenPost.'
	},
	OPENPOST_STOCK_MEDIA_ENABLED: {
		label: 'Pesquisa de multimédia de stock',
		description:
			'Ativa a pesquisa de stock quando está configurada pelo menos uma chave de fornecedor.'
	},
	OPENPOST_PEXELS_API_KEY: {
		label: 'Chave API da Pexels',
		description: 'Chave API opcional para a pesquisa na Pexels.'
	},
	OPENPOST_UNSPLASH_ACCESS_KEY: {
		label: 'Chave de acesso da Unsplash',
		description: 'Chave de acesso opcional para a pesquisa na Unsplash.'
	},
	OPENPOST_PIXABAY_API_KEY: {
		label: 'Chave API da Pixabay',
		description: 'Chave API opcional para a pesquisa na Pixabay.'
	},
	OPENPOST_FEEDBACK_ENABLED: {
		label: 'Comentários na aplicação',
		description: 'Mostra a ação de comentários e envia as submissões para o destino configurado.'
	},
	OPENPOST_FEEDBACK_DESTINATION_URL: {
		label: 'Destino dos comentários',
		description: 'Webhook ou formulário que recebe os comentários enviados.'
	},
	OPENPOST_FEEDBACK_RECIPIENT: {
		label: 'Destinatário dos comentários',
		description: 'Identificador opcional do destinatário enviado com os comentários.'
	},
	OPENPOST_FEEDBACK_SUPPORT_URL: {
		label: 'Ligação de suporte',
		description:
			'URL alternativa mostrada quando o envio direto de comentários não está disponível.'
	},
	OPENPOST_DISABLE_LINKEDIN_THREAD_REPLIES: {
		label: 'Desativar respostas de tópicos no LinkedIn',
		description: 'Publica apenas o primeiro segmento dos tópicos no LinkedIn.'
	},
	OPENPOST_LINKEDIN_ORGANIZATIONS_ENABLED: {
		label: 'Organizações do LinkedIn',
		description: 'Permite publicar em páginas de organizações quando a aplicação tem permissão.'
	},
	OPENPOST_X_MONTHLY_BUDGET_MICROUSD: {
		label: 'Orçamento mensal da API do X',
		description: 'Orçamento alojado da API do X em milionésimos de dólar americano.'
	},
	OPENPOST_X_POST_CREATE_COST_MICROUSD: {
		label: 'Custo de publicação na API do X',
		description:
			'Custo estimado de um pedido de publicação no X em milionésimos de dólar americano.'
	},
	OPENPOST_X_POST_CREATE_WITH_URL_COST_MICROUSD: {
		label: 'Custo de publicação com URL na API do X',
		description: 'Custo estimado de um pedido de publicação no X que contém um URL.'
	},
	OPENPOST_PROVIDER_USAGE_RETENTION_DAYS: {
		label: 'Retenção de utilização dos fornecedores',
		description:
			'Dias durante os quais são mantidos os registos de utilização e reserva. Use zero para os manter.'
	}
} satisfies Record<string, SettingCopy>;
const portugueseCopy = new Map(Object.entries(portugueseCopyDefinitions));

const portugueseOptionDefinitions = {
	'OPENPOST_EMAIL_PROVIDER:': 'Não configurado',
	'OPENPOST_EMAIL_PROVIDER:smtp': 'SMTP',
	'OPENPOST_EMAIL_PROVIDER:resend': 'Resend',
	'OPENPOST_EMAIL_PROVIDER:cloudflare': 'Email da Cloudflare',
	'OPENPOST_SMTP_TLS_MODE:starttls': 'STARTTLS',
	'OPENPOST_SMTP_TLS_MODE:tls': 'TLS',
	'OPENPOST_SMTP_TLS_MODE:none': 'Nenhum'
} satisfies Record<string, string>;
const portugueseOptions = new Map(Object.entries(portugueseOptionDefinitions));

export function instanceSettingCopy(setting: SettingCopyInput): SettingCopy {
	if (getCurrentLocale() !== 'pt') return setting;
	return portugueseCopy.get(setting.key) ?? setting;
}

export function instanceSettingOptionLabel(key: string, value: string, fallback: string): string {
	if (getCurrentLocale() !== 'pt') return fallback;
	return portugueseOptions.get(`${key}:${value}`) ?? fallback;
}
