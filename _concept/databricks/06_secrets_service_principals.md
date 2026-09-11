---
layout  : concept
title   : Secret과 Service Principal로 자격 증명 관리하기
date    : 2026-09-09 00:00:00 +0900
updated : 2026-09-09 00:00:00 +0900
tag     : databricks security secrets service-principal
toc     : true
comment : true
latex   : false
status  : draft
public  : true
parent  : [[/databricks]]
confidence     : medium
valid_from     : 2026-09-11
relations:
  - { type: references, target: /concept/databricks/01_databricks_intro }
  - { type: references, target: /concept/databricks/04_unity_catalog_governance }
  - { type: references, target: /concept/databricks/05_workflows_orchestration_monitoring }
---

* TOC
{:toc}

## 1. 노트북에 비밀번호를 그대로 쓰면 안 되는 이유

외부 API 키나 DB 비밀번호를 노트북 셀에 문자열로 박아두면, 그 노트북이 Repos로 Git에 커밋되는 순간 그 값이 저장소 히스토리에 영구히 남는다. 나중에 코드에서 지워도 과거 커밋을 뒤지면 그대로 나온다. 협업자가 노트북을 복제해서 보는 것만으로도 그 자격 증명을 그대로 손에 넣는다.

Databricks의 Secret은 이 값을 코드 밖에 저장해두고, 코드에서는 이름으로만 참조하게 만드는 장치다.

## 2. Secret Scope 두 종류

```bash
databricks secrets create-scope my-scope
databricks secrets put-secret my-scope db-password
```

```python
password = dbutils.secrets.get(scope="my-scope", key="db-password")
```

Databricks-backed scope는 Databricks 자체가 값을 암호화해서 저장한다. Azure Key Vault-backed scope는 값 자체는 Key Vault에 그대로 두고, Databricks는 그 Key Vault를 가리키는 참조만 가진다. Azure 환경이면 이미 조직에서 Key Vault로 비밀 관리를 통일하고 있는 경우가 많아서, 후자를 쓰면 Databricks 바깥의 감사·로테이션 정책을 그대로 물려받는다. AWS/GCP는 Databricks-backed scope가 기본 선택지다.

## 3. 로그에 자동으로 마스킹되는 값

```python
password = dbutils.secrets.get(scope="my-scope", key="db-password")
print(password)   # 출력: [REDACTED]
```

Secret로 가져온 값을 실수로 `print`하거나 로그에 찍어도, Databricks는 그 문자열이 Secret에서 나온 값이라는 걸 추적해서 노트북 출력과 Job 로그에서 자동으로 `[REDACTED]`로 가린다. 이 마스킹은 값 자체를 문자열로 정확히 매칭하는 방식이라, 값을 잘라서 일부만 출력하거나 다른 문자열과 이어붙이면(`password[:4] + "..."`) 마스킹이 안 먹힐 수 있다. Secret 값은 애초에 로그로 내보낼 필요가 없게 코드를 짜는 게 원칙이고, 마스킹은 실수를 줄여주는 보조 장치일 뿐 그 자체를 믿고 값을 가공해서 찍으면 안 된다.

## 4. Secret ACL로 스코프 단위 권한 걸기

```bash
databricks secrets put-acl my-scope analytics_team READ
databricks secrets put-acl my-scope data_platform_team MANAGE
```

Secret도 아무나 꺼내 쓸 수 있는 게 아니라 스코프 단위로 권한을 건다. `READ`는 값을 가져다 쓸 수만 있고, `MANAGE`는 새 키를 추가하거나 ACL 자체를 바꿀 수 있다. 문제는 이 권한이 스코프 단위라서, 한 스코프 안에 서로 다른 팀이 쓸 자격 증명을 섞어두면 그 스코프에 READ 권한을 가진 모든 사람이 그 안의 모든 키를 다 꺼낼 수 있다는 점이다. DB 비밀번호와 외부 API 키를 스코프 하나에 몰아넣지 않고, 자격 증명 성격별로 스코프를 나누는 게 최소 권한 원칙에 맞다.

## 5. 개인 계정으로 Job을 돌리면 안 되는 이유

Job을 만든 사람의 개인 계정 권한으로 그 Job이 계속 돌아가는 구조라면, 그 사람이 퇴사하거나 계정이 비활성화되는 순간 Job이 이유도 모른 채 실패하기 시작한다. 개인 계정은 조직 개편에 따라 소속 그룹이나 권한이 바뀌는데, 그 변화가 Job 실행 권한에도 그대로 영향을 준다. 사람과 Job의 생명주기가 묶여 있는 게 근본 문제다.

## 6. Service Principal로 Job 소유권을 사람에서 떼어내기

Service Principal은 사람이 아니라 애플리케이션/파이프라인을 위한 계정이다. Job의 `run_as`를 Service Principal로 지정하면, 그 Job은 만든 사람이 누구든 상관없이 그 Service Principal의 권한으로만 실행된다.

```json
{
  "run_as": { "service_principal_name": "sp-orders-pipeline" }
}
```

이렇게 해두면 Job을 만든 엔지니어가 팀을 옮기거나 퇴사해도 Job은 영향을 안 받는다. Unity Catalog 권한도 이 Service Principal 앞으로 걸어두면(`GRANT SELECT ON TABLE ... TO \`sp-orders-pipeline\``), 사람의 개인 권한과 파이프라인이 필요로 하는 권한이 완전히 분리된다.

## 7. OAuth M2M과 개인 액세스 토큰(PAT)

Service Principal이 API를 호출하거나 CI 파이프라인에서 인증할 때 크게 두 방식이 있다. PAT(Personal Access Token)는 발급하면 만료 전까지 그대로 유효한 고정 토큰이고, 예전부터 쓰이던 방식이라 관리가 단순하지만 탈취되면 만료 전까지 계속 악용될 수 있다. OAuth M2M(client credentials flow)은 client ID/secret으로 짧은 수명의 액세스 토큰을 그때그때 발급받는 방식이라, 토큰 자체가 탈취돼도 유효 기간이 짧아 피해 범위가 제한적이다.

```bash
curl -X POST https://<workspace-url>/oidc/v1/token \
  -d "grant_type=client_credentials&client_id=<sp-client-id>&client_secret=<sp-secret>&scope=all-apis"
```

새로 CI/CD 파이프라인을 구성한다면 PAT보다 OAuth M2M 쪽이 기본 선택지다. 기존에 PAT로 짜인 파이프라인을 굳이 지금 당장 바꿀 필요는 없지만, PAT의 만료 기한을 무기한으로 두는 관행만은 피해야 한다.

## 8. CI/CD에서 Service Principal로 DAB 배포하기

1장에서 다룬 Databricks Asset Bundles 배포도 결국 누군가의 자격 증명으로 실행된다. GitHub Actions 같은 CI 러너에서 사람의 PAT를 시크릿으로 박아두면 그 사람 계정이 배포 파이프라인의 단일 장애점이 된다.

```yaml
# .github/workflows/deploy.yml
env:
  DATABRICKS_CLIENT_ID: ${{ secrets.SP_CLIENT_ID }}
  DATABRICKS_CLIENT_SECRET: ${{ secrets.SP_CLIENT_SECRET }}
  DATABRICKS_HOST: https://prod-workspace.cloud.databricks.com
run: databricks bundle deploy --target prod
```

Service Principal의 client ID/secret을 CI 시크릿으로 등록해두면, `databricks bundle deploy`가 이 Service Principal 권한으로 실행되고 배포된 Job의 `run_as`도 자동으로 이 Service Principal이 된다. 사람 계정은 배포 과정에서 아예 등장하지 않는다.

## 9. PAT가 노출됐을 때 실제로 해야 하는 일

노트북이나 스크립트에 PAT를 실수로 하드코딩해서 커밋한 걸 뒤늦게 발견했다면, Git 히스토리에서 그 커밋만 지우는 걸로는 안 끝난다. 이미 복제됐거나 캐시된 어딘가에 그 값이 남아있을 수 있어서, 진짜 대응은 그 토큰 자체를 워크스페이스 설정에서 즉시 폐기(revoke)하는 것부터 시작한다.

```sql
SELECT event_time, user_identity.email, action_name, request_params
FROM system.access.audit
WHERE action_name IN ('tokenCreate', 'tokenDelete')
ORDER BY event_time DESC;
```

토큰을 폐기한 다음에는 그 토큰으로 그 사이 어떤 접근이 있었는지 4장에서 다룬 감사 로그(`system.access.audit`)로 확인해야, 실제로 악용이 있었는지 없었는지 판단할 근거가 생긴다. 토큰 폐기만 하고 그 이전 접근 기록을 확인하지 않으면 사고 범위를 모른 채 넘어가는 셈이다.

## 10. 결국 권한 모델은 사람이 아니라 ID 중심으로 짜야 한다

Secret Scope, Service Principal, Unity Catalog GRANT를 따로 보면 각각 다른 기능처럼 보이지만, 셋 다 같은 원칙을 향한다. 자격 증명과 권한을 특정 사람 개인이 아니라 그 일을 하는 주체(Service Principal이든 그룹이든)에 붙이는 것이다. 사람에게 직접 권한을 주는 구조는 그 사람이 조직을 떠나는 순간 권한 재배치라는 추가 작업이 필요해지고, 그 재배치가 누락되면 이미 퇴사한 계정이 프로덕션 파이프라인을 계속 돌리고 있는 상황도 생긴다. Service Principal 기반 소유권과 그룹 기반 GRANT를 처음부터 원칙으로 세워두면 이 문제 자체가 발생하지 않는다.
