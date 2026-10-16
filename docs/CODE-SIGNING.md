# PeakCAD code signing

Microsoft has not finished verifying the identity yet. Do not create a certificate profile until the identity status says **Completed**.

The Artifact Signing account is `artifactsigning`, in the resource group **PeakCAD**, on **Azure subscription 1**.

When a signed installer ships, Windows shows the verified publisher name instead of an unknown publisher. A brand-new file can still get one SmartScreen prompt until that exact file has been downloaded a few times.

## 1. Create the certificate profile

Do this only after identity validation is **Completed**.

1. Open the Artifact Signing account named `artifactsigning`.
2. Open **Certificate profiles**.
3. Choose **Create**, then **Public Trust**. Leave **Private** and **Public Trust Test** alone. Private is only for inside a company. Test certificates are not trusted by Windows.
4. Name it `peakcad-public`.
5. Under **Verified CN and O**, pick the identity that completed.
6. Leave **Include street address** and **Include postal code** unchecked. The certificate only needs the name.
7. Read **Certificate subject preview**. The name after `CN=` is the publisher name Windows will show. Copy that text exactly. It has to match the verified identity.
8. Create the profile.

Also note the account’s region. The build has to use that region’s signing address.

| Region | Endpoint |
| --- | --- |
| East US | `https://eus.codesigning.azure.net` |
| Central US | `https://cus.codesigning.azure.net` |
| West US | `https://wus.codesigning.azure.net` |
| West US 2 | `https://wus2.codesigning.azure.net` |
| West US 3 | `https://wus3.codesigning.azure.net` |
| North Central US | `https://ncus.codesigning.azure.net` |
| South Central US | `https://scus.codesigning.azure.net` |
| West Central US | `https://wcus.codesigning.azure.net` |
| North Europe | `https://neu.codesigning.azure.net` |
| West Europe | `https://weu.codesigning.azure.net` |

## 2. Let the build sign without clicking through Azure

1. In the Azure search bar, open **App registrations** and choose **New registration**.
2. Name it `peakcad-signer`. Keep **Single tenant**. Leave Redirect URI empty. Register.
3. Open that app, then **Certificates & secrets**, then **New client secret**. Copy the **Value** once. Azure will not show it again. Do not put it in the repo or in chat.
4. On the same app’s Overview page, copy the **Application (client) ID** and the **Directory (tenant) ID**.
5. Go back to the `artifactsigning` account, open **Access control (IAM)**, then **Add role assignment**.
6. Choose **Artifact Signing Certificate Profile Signer**.
7. On Members, choose **User, group, or service principal**, then **Select members**, and search for `peakcad-signer`. It will not appear until you search. Assign it.

## 3. Values the build needs

Send these four. Not the secret.

- Publisher name, copied from the certificate subject preview
- Certificate profile name (`peakcad-public`, unless another name was chosen)
- Signing account name (`artifactsigning`)
- Endpoint, such as `https://eus.codesigning.azure.net`

Those go into the Windows build so `npm run package:desktop` signs `PeakCAD.exe` and the installer. The secret stays on this machine as an environment variable:

- `AZURE_TENANT_ID` is the Directory (tenant) ID
- `AZURE_CLIENT_ID` is the Application (client) ID
- `AZURE_CLIENT_SECRET` is the secret value

electron-builder already supports this through `win.azureSignOptions`. Do not add that block until the four values above exist. An incomplete block would make the next installer build try to sign and fail.
