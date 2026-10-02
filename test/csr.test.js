import test from "node:test";import assert from "node:assert/strict";import {createCertificateKey,createCsr,csrBase64Url} from "../src/csr.js";
test("CSR is PKCS#10 DER",()=>{const key=createCertificateKey();const csr=createCsr({hostname:"example.com",...key});assert.equal(csr[0],0x30);assert.ok(csr.length>200);});
test("CSR base64url is decodable",()=>{const key=createCertificateKey();const value=csrBase64Url({hostname:"example.com",...key});assert.match(value,/^[A-Za-z0-9_-]+$/);});
