{{/*
Shared naming, labelling and env-wiring templates. Every Deployment/Job in this
chart builds its container spec out of these — no copy-pasted env blocks.
*/}}

{{/* Base name for every resource. Deliberately just the release name: the
oauth2-proxy subchart's upstream URLs (values.yaml) are release-name derived and
cannot call a parent helper, so there is no fullnameOverride to drift from. */}}
{{- define "chess-ai-coach.fullname" -}}
{{- .Release.Name | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Name of one component's resources, e.g. "chess-coach-api". */}}
{{- define "chess-ai-coach.componentName" -}}
{{- printf "%s-%s" (include "chess-ai-coach.fullname" .ctx) .component | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{- define "chess-ai-coach.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/* Labels that identify a pod/workload. Call as:
     {{- include "chess-ai-coach.selectorLabels" (dict "ctx" . "component" "api") }} */}}
{{- define "chess-ai-coach.selectorLabels" -}}
app.kubernetes.io/name: {{ .ctx.Chart.Name }}
app.kubernetes.io/instance: {{ .ctx.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{/* Full label set for resource metadata. Same call signature. */}}
{{- define "chess-ai-coach.labels" -}}
helm.sh/chart: {{ include "chess-ai-coach.chart" .ctx }}
{{ include "chess-ai-coach.selectorLabels" . }}
app.kubernetes.io/version: {{ .ctx.Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .ctx.Release.Service }}
{{- end -}}

{{/* Fully-qualified image reference for a component. Call as:
     {{ include "chess-ai-coach.image" (dict "ctx" . "image" .Values.api.image) }} */}}
{{- define "chess-ai-coach.image" -}}
{{- $registry := .ctx.Values.image.registry -}}
{{- $tag := .image.tag | default .ctx.Chart.AppVersion -}}
{{- if $registry -}}
{{- printf "%s/%s:%s" $registry .image.repository $tag -}}
{{- else -}}
{{- printf "%s:%s" .image.repository $tag -}}
{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.imagePullSecrets" -}}
{{- with .Values.image.pullSecrets }}
imagePullSecrets:
  {{- toYaml . | nindent 2 }}
{{- end }}
{{- end -}}

{{/* ---------------------------------------------------------------------
     Database wiring. When the bundled postgresql subchart is enabled its
     values are the single source of truth; otherwise `externalDatabase` is.
     --------------------------------------------------------------------- */}}

{{- define "chess-ai-coach.database.host" -}}
{{- if .Values.postgresql.enabled -}}
{{- printf "%s-postgresql" (include "chess-ai-coach.fullname" .) -}}
{{- else -}}
{{- required "externalDatabase.host is required when postgresql.enabled is false" .Values.externalDatabase.host -}}
{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.database.port" -}}
{{- if .Values.postgresql.enabled -}}5432{{- else -}}{{ .Values.externalDatabase.port }}{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.database.user" -}}
{{- if .Values.postgresql.enabled -}}
{{- .Values.postgresql.auth.username -}}
{{- else -}}
{{- .Values.externalDatabase.user -}}
{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.database.name" -}}
{{- if .Values.postgresql.enabled -}}
{{- .Values.postgresql.auth.database -}}
{{- else -}}
{{- .Values.externalDatabase.database -}}
{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.database.secretName" -}}
{{- if .Values.postgresql.enabled -}}
{{- required "postgresql.auth.existingSecret is required (architecture §11: no credentials in values.yaml)" .Values.postgresql.auth.existingSecret -}}
{{- else -}}
{{- required "externalDatabase.existingSecret is required" .Values.externalDatabase.existingSecret -}}
{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.database.passwordKey" -}}
{{- if .Values.postgresql.enabled -}}
{{- .Values.postgresql.auth.secretKeys.userPasswordKey -}}
{{- else -}}
{{- .Values.externalDatabase.existingSecretPasswordKey -}}
{{- end -}}
{{- end -}}

{{- define "chess-ai-coach.engineUrl" -}}
{{- printf "http://%s:%v" (include "chess-ai-coach.componentName" (dict "ctx" . "component" "engine")) .Values.engine.service.port -}}
{{- end -}}

{{/* ---------------------------------------------------------------------
     Env blocks. The password never appears as a literal: it is read from the
     `postgres-credentials` Secret into PGPASSWORD, then interpolated into
     DATABASE_URL by kubelet's $(VAR) expansion (which only resolves names
     declared earlier in this same container's env list).
     --------------------------------------------------------------------- */}}
{{- define "chess-ai-coach.env.database" -}}
{{- if not .Values.postgresql.enabled }}
- name: DATABASE_URL
  valueFrom:
    secretKeyRef:
      name: {{ required "externalDatabase.existingSecret is required when postgresql.enabled is false" .Values.externalDatabase.existingSecret }}
      key: {{ required "externalDatabase.existingSecretDatabaseUrlKey is required when postgresql.enabled is false" .Values.externalDatabase.existingSecretDatabaseUrlKey }}
{{- else }}
- name: PGPASSWORD
  valueFrom:
    secretKeyRef:
      name: {{ include "chess-ai-coach.database.secretName" . }}
      key: {{ include "chess-ai-coach.database.passwordKey" . }}
- name: DATABASE_URL
  value: postgresql://{{ include "chess-ai-coach.database.user" . }}:$(PGPASSWORD)@{{ include "chess-ai-coach.database.host" . }}:{{ include "chess-ai-coach.database.port" . }}/{{ include "chess-ai-coach.database.name" . }}?sslmode={{ .Values.database.sslMode }}
{{- end }}
{{- end -}}

{{/* Everything apps/api/src/{server,worker}.ts read at boot beyond the DB. */}}
{{- define "chess-ai-coach.env.app" -}}
- name: AUTH_MODE
  value: {{ .Values.api.authMode | quote }}
- name: ENGINE_URL
  value: {{ include "chess-ai-coach.engineUrl" . | quote }}
- name: LLM_STANDARD_MODEL_ANTHROPIC
  value: {{ .Values.llm.standardModel.anthropic | quote }}
- name: LLM_STANDARD_MODEL_OPENAI
  value: {{ .Values.llm.standardModel.openai | quote }}
- name: LLM_LIGHT_MODEL_ANTHROPIC
  value: {{ .Values.llm.lightModel.anthropic | quote }}
- name: LLM_LIGHT_MODEL_OPENAI
  value: {{ .Values.llm.lightModel.openai | quote }}
- name: LLM_FAKE
  value: {{ ternary "1" "0" .Values.llm.fake | quote }}
- name: LLM_KEY_MASTER_KEY
  valueFrom:
    secretKeyRef:
      name: {{ required "llm.masterKey.existingSecret is required" .Values.llm.masterKey.existingSecret }}
      key: {{ .Values.llm.masterKey.key }}
{{- if .Values.llm.platformKeys.enabled }}
- name: ANTHROPIC_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ required "llm.platformKeys.existingSecret is required" .Values.llm.platformKeys.existingSecret }}
      key: {{ .Values.llm.platformKeys.anthropicKey }}
      optional: true
- name: OPENAI_API_KEY
  valueFrom:
    secretKeyRef:
      name: {{ .Values.llm.platformKeys.existingSecret }}
      key: {{ .Values.llm.platformKeys.openaiKey }}
      optional: true
{{- end }}
{{- if .Values.stripe.enabled }}
{{- $secret := required "stripe.existingSecret is required when stripe.enabled" .Values.stripe.existingSecret }}
- name: STRIPE_SECRET_KEY
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ .Values.stripe.keys.secretKey }}
- name: STRIPE_WEBHOOK_SECRET
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ .Values.stripe.keys.webhookSecret }}
- name: STRIPE_PRICE_SMALL
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ .Values.stripe.keys.priceSmall }}
- name: STRIPE_PRICE_MEDIUM
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ .Values.stripe.keys.priceMedium }}
- name: STRIPE_PRICE_LARGE
  valueFrom:
    secretKeyRef:
      name: {{ $secret }}
      key: {{ .Values.stripe.keys.priceLarge }}
- name: STRIPE_CHECKOUT_SUCCESS_URL
  value: {{ required "stripe.checkoutSuccessUrl is required when stripe.enabled" .Values.stripe.checkoutSuccessUrl | quote }}
- name: STRIPE_CHECKOUT_CANCEL_URL
  value: {{ required "stripe.checkoutCancelUrl is required when stripe.enabled" .Values.stripe.checkoutCancelUrl | quote }}
{{- end }}
{{- with .Values.extraEnv }}
{{ toYaml . }}
{{- end }}
{{- end -}}

{{/* Pod- and container-level hardening shared by every workload (§12). */}}
{{- define "chess-ai-coach.podSecurityContext" -}}
{{- toYaml .Values.podSecurityContext -}}
{{- end -}}

{{- define "chess-ai-coach.containerSecurityContext" -}}
{{- toYaml .Values.containerSecurityContext -}}
{{- end -}}
