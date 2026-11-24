// Anti-SSRF IP filter: v4, v6, mapped, ULA, link-local.
import { test } from "node:test";
import assert from "node:assert/strict";
import { blockedAddress } from "./ip-filter";

test("IPv4: public pass, private/loopback/link-local refused", () => {
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "100.128.0.1"])
    assert.equal(blockedAddress(ip), false, ip);
  for (const ip of [
    "169.254.169.254",
    "127.0.0.1",
    "10.1.2.3",
    "172.16.0.1",
    "192.168.1.1",
    "100.64.0.1",
    "0.0.0.0",
    "224.0.0.1",
    "999.1.1.1",
  ])
    assert.equal(blockedAddress(ip), true, ip);
});

test("IPv6: ULA, link-local, loopback, mapped", () => {
  for (const ip of ["2606:4700:4700::1111", "[2001:db8::1]", "::ffff:8.8.8.8"])
    assert.equal(blockedAddress(ip), false, ip);
  for (const ip of [
    "::1",
    "::",
    "[::1]",
    "fd00::1",
    "fc00::1",
    "fe80::1",
    "fe80::1%en0",
    "febf::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:169.254.169.254",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "0:0:0:0:0:ffff:10.0.0.1",
    "1::2::3",
    "nope",
  ])
    assert.equal(blockedAddress(ip), true, ip);
});

test("private network allowed: link-local and metadata stay refused", () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "::1", "fd00::1"])
    assert.equal(blockedAddress(ip, true), false, ip);
  for (const ip of [
    "169.254.169.254",
    "fe80::1",
    "::ffff:169.254.169.254",
    "::",
  ])
    assert.equal(blockedAddress(ip, true), true, ip);
});

test("embedded IPv4 and reserved ranges", () => {
  for (const ip of [
    "64:ff9b::127.0.0.1",
    "64:ff9b::a9fe:a9fe",
    "64:ff9b::10.0.0.1",
    "2002:7f00:1::",
    "2002:a9fe:a9fe::1",
    "2002:c0a8:101::",
    "198.18.0.1",
    "198.19.255.255",
    "192.0.0.192",
    "192.0.0.1",
    "fec0::1",
    "fdff::1",
    "fe80::abcd",
  ])
    assert.equal(blockedAddress(ip), true, ip);
  for (const ip of [
    "64:ff9b::8.8.8.8",
    "2002:808:808::",
    "198.20.0.1",
    "192.0.2.1",
    "192.0.1.1",
    "2001:4860:4860::8888",
  ])
    assert.equal(blockedAddress(ip), false, ip);
  // Metadata through NAT64/6to4 stays refused with private network allowed.
  assert.equal(blockedAddress("64:ff9b::a9fe:a9fe", true), true);
  assert.equal(blockedAddress("2002:a9fe:a9fe::", true), true);
});
