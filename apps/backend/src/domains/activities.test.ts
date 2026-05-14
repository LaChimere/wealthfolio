import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  createActivityService,
  type Activity,
  type ActivityBulkMutationResult,
  type ActivitySearchRequest,
} from "./activities";

describe("TS activities import domain", () => {
  test("searches activities with Rust-compatible filters, ordering, and detail mapping", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);
    const search = (request: ActivitySearchRequest) =>
      Promise.resolve(service.searchActivities!(request));

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAccount(db, { id: "account-2", name: "Beta", currency: "CAD" });
      insertAccount(db, { id: "archived", name: "Archived", currency: "USD", isArchived: true });
      insertAsset(db, {
        id: "asset-z",
        displayCode: "AAA",
        name: "Alphabet Alias",
        instrumentType: "EQUITY",
      });
      insertAsset(db, {
        id: "asset-a",
        displayCode: "ZZZ",
        name: "Zulu Alias",
        instrumentType: "EQUITY",
      });
      insertActivity(db, {
        id: "posted-needs-review-column",
        accountId: "account-1",
        assetId: "asset-z",
        activityType: "BUY",
        status: "POSTED",
        activityDate: "2024-01-15T10:00:00Z",
        quantity: "2.5",
        unitPrice: "4",
        amount: null,
        notes: "provider note",
        needsReview: true,
        metadata: JSON.stringify({ custom: true }),
        createdAt: "2024-01-15T10:00:02Z",
      });
      insertActivity(db, {
        id: "unknown-status",
        accountId: "account-1",
        assetId: "asset-a",
        activityType: "SELL",
        status: "BROKEN",
        activityDate: "2024-01-15T10:00:00Z",
        notes: "other note",
        metadata: "not-json",
        createdAt: "2024-01-15T10:00:01Z",
      });
      insertActivity(db, {
        id: "draft-cash",
        accountId: "account-1",
        assetId: null,
        activityType: "DEPOSIT",
        status: "DRAFT",
        activityDate: "2024-01-15T23:59:58Z",
        amount: "100",
        notes: "cash memo",
      });
      insertActivity(db, {
        id: "archived-row",
        accountId: "archived",
        activityType: "BUY",
        status: "POSTED",
        activityDate: "2024-01-15T11:00:00Z",
      });

      await expect(
        search({
          page: 0,
          pageSize: 2,
          dateFrom: "2024-01-15",
          dateTo: "2024-01-15",
        }),
      ).resolves.toEqual({
        data: [
          expect.objectContaining({
            id: "draft-cash",
            assetId: "",
            assetSymbol: "",
            status: "DRAFT",
            metadata: null,
          }),
          expect.objectContaining({
            id: "unknown-status",
            status: "POSTED",
            assetSymbol: "ZZZ",
            assetPricingMode: "MARKET",
            metadata: null,
          }),
        ],
        meta: { totalRowCount: 3 },
      });

      await expect(
        search({
          page: 0,
          pageSize: 10,
          sort: { id: "assetSymbol", desc: false },
          instrumentTypes: ["EQUITY"],
        }).then((response) => response.data.map((activity) => activity.id)),
      ).resolves.toEqual(["unknown-status", "posted-needs-review-column"]);

      await expect(
        search({
          page: 0,
          pageSize: 10,
          needsReview: true,
        }).then((response) => response.data.map((activity) => activity.id)),
      ).resolves.toEqual(["draft-cash"]);

      await expect(
        search({
          page: 0,
          pageSize: 10,
          assetIdKeyword: "provider note",
        }).then((response) => response.data),
      ).resolves.toEqual([
        expect.objectContaining({
          id: "posted-needs-review-column",
          amount: "10",
          metadata: { custom: true },
          needsReview: true,
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("creates activities with Rust-compatible defaults, normalization, and idempotency", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
      });
      insertAsset(db, {
        id: "LSE",
        displayCode: "LSE",
        name: "London",
        quoteCcy: "GBP",
      });

      const created = service.createActivity?.({
        id: "client-temp-id",
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15T10:30:00Z",
        quantity: "-100.00",
        unitPrice: "150.0",
        amount: "15000.00",
        currency: "USD",
        fee: "-1.5",
      }) as Activity;

      expect(created).toMatchObject({
        accountId: "account-1",
        assetId: "AAPL",
        activityType: "BUY",
        status: "POSTED",
        activityDate: "2025-01-15T10:30:00+00:00",
        quantity: "100",
        unitPrice: "150",
        amount: "15000",
        fee: "1.5",
        sourceSystem: "MANUAL",
        isUserModified: false,
        needsReview: false,
        idempotencyKey: "b1f49d68f26eee140ec8198d64cb1552865f71848e924922b5aceeac0fdee5bf",
      });
      expect(created.id).not.toBe("client-temp-id");

      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          asset: { id: "AAPL" },
          activityType: "BUY",
          activityDate: "2025-01-15T23:59:59Z",
          quantity: "100.0",
          unitPrice: "150",
          amount: "15000",
          currency: "USD",
        }),
      ).toThrow("Duplicate activity detected");

      const minorCurrency = service.createActivity?.({
        accountId: "account-1",
        asset: { id: "LSE" },
        activityType: "BUY",
        activityDate: "2025-01-16",
        quantity: "1",
        unitPrice: "250",
        amount: "250",
        currency: "GBp",
        fee: "10",
      }) as Activity;

      expect(minorCurrency).toMatchObject({
        activityDate: "2025-01-16T00:00:00+00:00",
        unitPrice: "2.5",
        amount: "2.5",
        fee: "0.1",
        currency: "GBP",
      });
    } finally {
      db.close();
    }
  });

  test("rejects unsupported or invalid activity creates before persistence", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          activityType: "BUY",
          activityDate: "2025-01-15",
          currency: "USD",
        }),
      ).toThrow("Asset-backed activities need either asset_id or symbol");
      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          asset: { symbol: "AAPL" },
          activityType: "BUY",
          activityDate: "2025-01-15",
          currency: "USD",
        }),
      ).toThrow("Symbol-based activity asset resolution is not yet implemented");
      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          activityType: "SPLIT",
          activityDate: "2025-01-15",
          currency: "USD",
          amount: "0",
        }),
      ).toThrow("Split activities require a positive amount ratio");
      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          activityType: "DEPOSIT",
          activityDate: "2025/01/15",
          currency: "USD",
        }),
      ).toThrow("Invalid date format");
    } finally {
      db.close();
    }
  });

  test("updates activities with Rust-compatible patch preservation and clearing", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, { id: "AAPL", displayCode: "AAPL", name: "Apple", quoteCcy: "USD" });
      insertAsset(db, { id: "MSFT", displayCode: "MSFT", name: "Microsoft", quoteCcy: "USD" });
      insertActivity(db, {
        id: "update-me",
        accountId: "account-1",
        assetId: "AAPL",
        activityType: "BUY",
        subtype: "BONUS",
        status: "DRAFT",
        activityDate: "2024-01-01T00:00:00Z",
        quantity: "10",
        unitPrice: "5",
        amount: "50",
        fee: "1",
        fxRate: "1.2",
        notes: "old note",
        metadata: JSON.stringify({ keep: true }),
        sourceSystem: "SNAPTRADE",
        sourceRecordId: "provider-record",
        sourceGroupId: "provider-group",
        idempotencyKey: "stable-key",
        importRunId: "import-run",
        isUserModified: false,
        needsReview: true,
        createdAt: "2024-01-01T00:00:00Z",
      });

      const updated = service.updateActivity?.({
        id: "update-me",
        accountId: "account-1",
        asset: { id: "MSFT" },
        activityType: "TRANSFER_IN",
        subtype: "",
        activityDate: "2024-02-01",
        unitPrice: "-7",
        amount: "999",
        fee: null,
        currency: "GBp",
        comment: "new note",
      }) as Activity;

      expect(updated).toMatchObject({
        id: "update-me",
        accountId: "account-1",
        assetId: "MSFT",
        activityType: "TRANSFER_IN",
        subtype: null,
        status: "POSTED",
        activityDate: "2024-02-01T00:00:00+00:00",
        quantity: "10",
        unitPrice: "0.07",
        amount: null,
        fee: null,
        currency: "GBP",
        fxRate: "1.2",
        notes: "new note",
        metadata: { keep: true },
        sourceSystem: "SNAPTRADE",
        sourceRecordId: "provider-record",
        sourceGroupId: "provider-group",
        idempotencyKey: "stable-key",
        importRunId: "import-run",
        isUserModified: true,
        needsReview: false,
        createdAt: "2024-01-01T00:00:00Z",
      });
    } finally {
      db.close();
    }
  });

  test("bulk mutates activities atomically with created mappings and per-entry errors", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, { id: "AAPL", displayCode: "AAPL", name: "Apple", quoteCcy: "USD" });
      insertActivity(db, {
        id: "bulk-update",
        accountId: "account-1",
        assetId: "AAPL",
        activityType: "BUY",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        idempotencyKey: "bulk-update-key",
      });
      insertActivity(db, {
        id: "bulk-delete",
        accountId: "account-1",
        activityType: "DEPOSIT",
        amount: "20",
        idempotencyKey: "bulk-delete-key",
      });

      const result = service.bulkMutateActivities?.({
        creates: [
          {
            id: "temp-create",
            accountId: "account-1",
            activityType: "DEPOSIT",
            activityDate: "2025-02-01",
            amount: "42",
            currency: "USD",
          },
        ],
        updates: [
          {
            id: "bulk-update",
            accountId: "account-1",
            asset: { id: "AAPL" },
            activityType: "SELL",
            activityDate: "2025-02-02",
            quantity: "1",
            unitPrice: "12",
            amount: "12",
            currency: "USD",
            comment: "updated through bulk",
          },
        ],
        deleteIds: ["bulk-delete"],
      }) as ActivityBulkMutationResult;

      expect(result.errors).toEqual([]);
      expect(result.created).toEqual([
        expect.objectContaining({
          id: expect.any(String),
          activityType: "DEPOSIT",
          amount: "42",
        }),
      ]);
      expect(result.created[0]?.id).not.toBe("temp-create");
      expect(result.createdMappings).toEqual([
        { tempId: "temp-create", activityId: result.created[0]?.id },
      ]);
      expect(result.updated).toEqual([
        expect.objectContaining({
          id: "bulk-update",
          activityType: "SELL",
          amount: "12",
          notes: "updated through bulk",
        }),
      ]);
      expect(result.deleted).toEqual([
        expect.objectContaining({
          id: "bulk-delete",
          amount: "20",
        }),
      ]);
      expect(readActivityValue(db, "bulk-delete", "id")).toBeNull();

      insertActivity(db, {
        id: "replace-me",
        accountId: "account-1",
        activityType: "DEPOSIT",
        amount: "77",
        idempotencyKey: "replace-key",
      });
      const replacement = service.bulkMutateActivities?.({
        creates: [
          {
            id: "replacement-temp",
            idempotencyKey: "replace-key",
            accountId: "account-1",
            activityType: "DEPOSIT",
            activityDate: "2025-02-04",
            amount: "77",
            currency: "USD",
          },
        ],
        deleteIds: ["replace-me"],
      }) as ActivityBulkMutationResult;

      expect(replacement.errors).toEqual([]);
      expect(replacement.deleted).toEqual([expect.objectContaining({ id: "replace-me" })]);
      expect(replacement.created).toEqual([
        expect.objectContaining({ idempotencyKey: "replace-key", amount: "77" }),
      ]);
      expect(replacement.createdMappings).toEqual([
        { tempId: "replacement-temp", activityId: replacement.created[0]?.id },
      ]);

      insertActivity(db, {
        id: "delete-candidate",
        accountId: "account-1",
        activityType: "DEPOSIT",
        amount: "99",
        idempotencyKey: "delete-candidate-key",
      });
      const failed = service.bulkMutateActivities?.({
        creates: [
          {
            id: "dup-temp",
            accountId: "account-1",
            activityType: "DEPOSIT",
            activityDate: "2025-02-01",
            amount: "42",
            currency: "USD",
          },
        ],
        updates: [
          {
            id: "missing-update",
            accountId: "account-1",
            activityType: "DEPOSIT",
            activityDate: "2025-02-03",
            currency: "USD",
          },
          {
            id: "delete-candidate",
            accountId: "account-1",
            activityType: "DEPOSIT",
            activityDate: "2025-02-03",
            currency: "USD",
          },
        ],
        deleteIds: ["delete-candidate", "missing-delete"],
      }) as ActivityBulkMutationResult;

      expect(failed).toMatchObject({
        created: [],
        updated: [],
        deleted: [],
        createdMappings: [],
        errors: [
          { id: "dup-temp", action: "create", message: expect.stringContaining("Duplicate") },
          {
            id: "missing-update",
            action: "update",
            message: expect.stringContaining("missing-update"),
          },
          {
            id: "delete-candidate",
            action: "update",
            message: "Cannot update and delete the same activity",
          },
          {
            id: "missing-delete",
            action: "delete",
            message: expect.stringContaining("missing-delete"),
          },
        ],
      });
      expect(readActivityValue(db, "delete-candidate", "id")).toBe("delete-candidate");
    } finally {
      db.close();
    }
  });

  test("links and unlinks transfer pairs with Rust-compatible metadata behavior", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);
    const linkTransfers = (activityAId: string, activityBId: string) =>
      service.linkTransferActivities!(activityAId, activityBId) as [Activity, Activity];
    const unlinkTransfers = (activityAId: string, activityBId: string) =>
      service.unlinkTransferActivities!(activityAId, activityBId) as [Activity, Activity];

    try {
      insertActivity(db, {
        id: "transfer-in",
        accountId: "account-1",
        activityType: "TRANSFER_IN",
        metadata: JSON.stringify({ custom: "keep", flow: { origin: "import" } }),
      });
      insertActivity(db, {
        id: "transfer-out",
        accountId: "account-2",
        activityType: "TRANSFER_OUT",
        metadata: JSON.stringify({ other: true }),
      });

      const [linkedIn, linkedOut] = linkTransfers("transfer-out", "transfer-in");

      expect(linkedIn).toMatchObject({
        id: "transfer-in",
        activityType: "TRANSFER_IN",
        isUserModified: true,
        metadata: { custom: "keep", flow: { origin: "import", is_external: false } },
      });
      expect(linkedOut).toMatchObject({
        id: "transfer-out",
        activityType: "TRANSFER_OUT",
        isUserModified: true,
        metadata: { other: true, flow: { is_external: false } },
      });
      expect(linkedIn.sourceGroupId).toBeTruthy();
      expect(linkedIn.sourceGroupId).toBe(linkedOut.sourceGroupId);
      expect(linkedIn.updatedAt).toContain("T");
      expect(readActivityValue(db, "transfer-in", "source_group_id")).toBe(linkedIn.sourceGroupId);

      expect(() => service.linkTransferActivities?.("transfer-in", "transfer-out")).toThrow(
        "One or both activities are already linked to another transfer",
      );

      const [unlinkedIn, unlinkedOut] = unlinkTransfers("transfer-in", "transfer-out");

      expect(unlinkedIn).toMatchObject({
        id: "transfer-in",
        sourceGroupId: null,
        metadata: { custom: "keep", flow: { origin: "import", is_external: true } },
      });
      expect(unlinkedOut).toMatchObject({
        id: "transfer-out",
        sourceGroupId: null,
        metadata: { other: true, flow: { is_external: true } },
      });
      expect(readActivityValue(db, "transfer-in", "source_group_id")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("rejects invalid transfer link and unlink requests", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertActivity(db, { id: "in-1", accountId: "account-1", activityType: "TRANSFER_IN" });
      insertActivity(db, { id: "in-2", accountId: "account-2", activityType: "TRANSFER_IN" });
      insertActivity(db, { id: "out-same", accountId: "account-1", activityType: "TRANSFER_OUT" });
      insertActivity(db, {
        id: "out-linked-a",
        accountId: "account-2",
        activityType: "TRANSFER_OUT",
        sourceGroupId: "group-a",
      });
      insertActivity(db, {
        id: "in-linked-b",
        accountId: "account-1",
        activityType: "TRANSFER_IN",
        sourceGroupId: "group-b",
      });

      expect(() => service.linkTransferActivities?.("in-1", "in-1")).toThrow(
        "Cannot link an activity to itself",
      );
      expect(() => service.linkTransferActivities?.("in-1", "in-2")).toThrow(
        "Linking requires one TRANSFER_IN and one TRANSFER_OUT activity",
      );
      expect(() => service.linkTransferActivities?.("in-1", "out-same")).toThrow(
        "Both transfer legs share the same account",
      );
      expect(() => service.unlinkTransferActivities?.("in-1", "out-same")).toThrow(
        "Both activities must already be linked",
      );
      expect(() => service.unlinkTransferActivities?.("in-linked-b", "out-linked-a")).toThrow(
        "Selected activities belong to different linked transfers",
      );
    } finally {
      db.close();
    }
  });

  test("deletes an activity and returns the deleted row", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertActivity(db, {
        id: "delete-me",
        accountId: "account-1",
        activityType: "DIVIDEND",
        amount: "12.34",
        idempotencyKey: "delete-key",
        metadata: JSON.stringify({ source: "manual" }),
      });

      expect(service.deleteActivity?.("delete-me")).toMatchObject({
        id: "delete-me",
        activityType: "DIVIDEND",
        amount: "12.34",
        idempotencyKey: "delete-key",
        metadata: { source: "manual" },
      });
      expect(readActivityValue(db, "delete-me", "id")).toBeNull();
      expect(() => service.deleteActivity?.("missing")).toThrow(
        "Record not found: activity missing",
      );
    } finally {
      db.close();
    }
  });

  test("returns Rust-compatible default import mapping with legacy context normalization", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      const mapping = await service.getImportMapping?.("account-1", "ACTIVITY");

      expect(mapping).toMatchObject({
        accountId: "account-1",
        contextKind: "CSV_ACTIVITY",
        name: "",
        fieldMappings: {
          date: "date",
          symbol: "symbol",
          quantity: "quantity",
          activityType: "activityType",
        },
        activityMappings: {
          BUY: ["BUY"],
          SELL: ["SELL"],
          ADJUSTMENT: ["ADJUSTMENT"],
        },
      });
      expect(mapping?.templateId).toBeUndefined();
    } finally {
      db.close();
    }
  });

  test("saves account-local import mappings and preserves link identity on updates", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      const first = await service.saveImportMapping?.({
        accountId: "account-1",
        importType: "HOLDINGS",
        name: "Holdings CSV",
        fieldMappings: { symbol: ["Ticker", "Symbol"], quantity: "Qty" },
        activityMappings: { BUY: ["Buy"] },
        symbolMappings: { BRK_B: "BRK-B" },
        accountMappings: { External: "account-1" },
        symbolMappingMeta: { BRK_B: { exchangeMic: "XNYS", symbolName: "Berkshire" } },
        parseConfig: { delimiter: ",", hasHeaderRow: true },
      });
      const linkId = readLinkId(db, "account-1", "CSV_HOLDINGS");

      expect(first).toMatchObject({
        accountId: "account-1",
        contextKind: "CSV_HOLDINGS",
        name: "Holdings CSV",
      });
      expect(readLinkedTemplateId(db, "account-1", "CSV_HOLDINGS")).toBe("acct_account-1_holdings");
      expect(JSON.parse(readTemplateConfig(db, "acct_account-1_holdings"))).toEqual({
        fieldMappings: { symbol: ["Ticker", "Symbol"], quantity: "Qty" },
        activityMappings: { BUY: ["Buy"] },
        symbolMappings: { BRK_B: "BRK-B" },
        accountMappings: { External: "account-1" },
        symbolMappingMeta: { BRK_B: { exchangeMic: "XNYS", symbolName: "Berkshire" } },
        parseConfig: { delimiter: ",", hasHeaderRow: true },
      });

      await service.saveImportMapping?.({
        accountId: "account-1",
        contextKind: "CSV_HOLDINGS",
        name: "Holdings CSV v2",
        fieldMappings: { symbol: "Symbol" },
      });

      expect(readLinkId(db, "account-1", "CSV_HOLDINGS")).toBe(linkId);
      expect((await service.getImportMapping?.("account-1", "CSV_HOLDINGS"))?.name).toBe(
        "Holdings CSV v2",
      );
    } finally {
      db.close();
    }
  });

  test("relinks shared templates to account-local mappings without changing link row identity", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      await service.saveImportTemplate?.({
        id: "system_like",
        name: "Shared",
        scope: "SYSTEM",
        kind: "CSV_ACTIVITY",
        fieldMappings: { date: "Date" },
      });
      await service.linkAccountTemplate?.("account-1", "system_like", "ACTIVITY");
      const linkId = readLinkId(db, "account-1", "CSV_ACTIVITY");

      await service.saveImportMapping?.({
        accountId: "account-1",
        contextKind: "ACTIVITY",
        name: "Account CSV",
        fieldMappings: { date: "Trade Date" },
      });

      expect(readLinkId(db, "account-1", "CSV_ACTIVITY")).toBe(linkId);
      expect(readLinkedTemplateId(db, "account-1", "CSV_ACTIVITY")).toBe("acct_account-1");
      expect((await service.getImportMapping?.("account-1", "ACTIVITY"))?.fieldMappings).toEqual({
        date: "Trade Date",
      });
    } finally {
      db.close();
    }
  });

  test("lists, reads, saves, links, and deletes import templates with Rust-compatible scope and kind behavior", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertTemplate(db, {
        id: "broker",
        name: "Broker",
        scope: "SYSTEM",
        kind: "BROKER_ACTIVITY",
      });
      insertTemplate(db, {
        id: "system",
        name: "System",
        scope: "SYSTEM",
        kind: "CSV_ACTIVITY",
      });
      insertTemplate(db, {
        id: "user_upper",
        name: "Upper",
        scope: "USER",
        kind: "CSV_HOLDINGS",
      });
      insertTemplate(db, {
        id: "user_lower",
        name: "Lower",
        scope: "user",
        kind: "CSV_ACTIVITY",
      });

      expect((await service.listImportTemplates?.())?.map((template) => template.id)).toEqual([
        "system",
        "user_upper",
        "user_lower",
      ]);
      expect(await service.getImportTemplate?.("missing")).toMatchObject({
        id: "missing",
        scope: "USER",
        kind: "CSV_ACTIVITY",
        fieldMappings: expect.objectContaining({ date: "date" }),
      });

      const saved = await service.saveImportTemplate?.({
        id: "custom",
        name: "Custom",
        scope: "USER",
        kind: "CSV_HOLDINGS",
        fieldMappings: { symbol: "Ticker" },
        parseConfig: { delimiter: ";" },
      });
      expect(saved).toMatchObject({ id: "custom", kind: "CSV_HOLDINGS" });
      await service.linkAccountTemplate?.("account-2", "custom", "HOLDINGS");
      expect(readLinkedTemplateId(db, "account-2", "CSV_HOLDINGS")).toBe("custom");

      await service.deleteImportTemplate?.("custom");
      expect(readLinkedTemplateId(db, "account-2", "CSV_HOLDINGS")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("checks existing duplicate idempotency keys with empty input and chunked lookups", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertActivity(db, "activity-1", "key-1");
      insertActivity(db, "activity-2", "key-2");
      insertActivity(db, "activity-null", null);

      expect(await service.checkExistingDuplicates?.([])).toEqual({});
      expect(
        await service.checkExistingDuplicates?.([
          "missing",
          ...Array.from({ length: 500 }, (_, index) => `other-${index}`),
          "key-2",
          "key-1",
        ]),
      ).toEqual({ "key-1": "activity-1", "key-2": "activity-2" });
    } finally {
      db.close();
    }
  });
});

function createActivitiesDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE import_templates (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL DEFAULT '',
      scope TEXT NOT NULL DEFAULT 'USER',
      kind TEXT NOT NULL DEFAULT 'CSV_ACTIVITY',
      source_system TEXT NOT NULL DEFAULT '',
      config_version INTEGER NOT NULL DEFAULT 1,
      config TEXT NOT NULL DEFAULT '{}',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE import_account_templates (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      context_kind TEXT NOT NULL DEFAULT 'CSV_ACTIVITY',
      source_system TEXT NOT NULL DEFAULT '',
      template_id TEXT NOT NULL REFERENCES import_templates(id) ON DELETE CASCADE,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE (account_id, context_kind, source_system)
    );

    CREATE TABLE activities (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      asset_id TEXT,
      activity_type TEXT NOT NULL,
      activity_type_override TEXT,
      source_type TEXT,
      subtype TEXT,
      status TEXT NOT NULL DEFAULT 'POSTED',
      activity_date TEXT NOT NULL,
      settlement_date TEXT,
      quantity TEXT,
      unit_price TEXT,
      amount TEXT,
      fee TEXT,
      currency TEXT NOT NULL,
      fx_rate TEXT,
      notes TEXT,
      metadata TEXT,
      source_system TEXT,
      source_record_id TEXT,
      source_group_id TEXT,
      idempotency_key TEXT,
      import_run_id TEXT,
      is_user_modified INTEGER NOT NULL DEFAULT 0,
      needs_review INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      currency TEXT NOT NULL,
      is_archived INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE assets (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT,
      display_code TEXT,
      instrument_exchange_mic TEXT,
      quote_mode TEXT,
      quote_ccy TEXT NOT NULL DEFAULT 'USD',
      instrument_type TEXT
    );

    CREATE UNIQUE INDEX ux_activities_idempotency_key
    ON activities(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  `);
  return db;
}

function insertTemplate(
  db: Database,
  template: { id: string; name: string; scope: string; kind: string },
): void {
  db.query(
    `
      INSERT INTO import_templates (
        id, name, scope, kind, source_system, config_version, config, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, '', 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
  ).run(
    template.id,
    template.name,
    template.scope,
    template.kind,
    JSON.stringify({
      fieldMappings: { date: "Date" },
      activityMappings: { BUY: ["Buy"] },
      symbolMappings: {},
      accountMappings: {},
      symbolMappingMeta: {},
      parseConfig: { delimiter: "," },
    }),
  );
}

interface AccountFixture {
  id: string;
  name: string;
  currency: string;
  isArchived?: boolean;
}

interface AssetFixture {
  id: string;
  displayCode: string;
  name: string;
  instrumentType?: string | null;
  quoteMode?: string | null;
  quoteCcy?: string;
  exchangeMic?: string | null;
}

interface ActivityFixture {
  id: string;
  accountId?: string;
  assetId?: string | null;
  activityType?: string;
  subtype?: string | null;
  status?: string;
  activityDate?: string;
  quantity?: string | null;
  unitPrice?: string | null;
  amount?: string | null;
  fee?: string | null;
  currency?: string;
  fxRate?: string | null;
  notes?: string | null;
  metadata?: string | null;
  sourceSystem?: string | null;
  sourceRecordId?: string | null;
  sourceGroupId?: string | null;
  idempotencyKey?: string | null;
  importRunId?: string | null;
  isUserModified?: boolean;
  needsReview?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

function insertAccount(db: Database, account: AccountFixture): void {
  db.query(
    `
      INSERT INTO accounts (id, name, currency, is_archived)
      VALUES (?, ?, ?, ?)
    `,
  ).run(account.id, account.name, account.currency, account.isArchived ? 1 : 0);
}

function insertAsset(db: Database, asset: AssetFixture): void {
  db.query(
    `
      INSERT INTO assets (
        id, name, display_code, instrument_exchange_mic, quote_mode, quote_ccy, instrument_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    asset.id,
    asset.name,
    asset.displayCode,
    asset.exchangeMic ?? null,
    asset.quoteMode ?? "MARKET",
    asset.quoteCcy ?? "USD",
    asset.instrumentType ?? null,
  );
}

function insertActivity(
  db: Database,
  activityOrId: ActivityFixture | string,
  idempotencyKey?: string | null,
): void {
  const activity =
    typeof activityOrId === "string" ? { id: activityOrId, idempotencyKey } : activityOrId;
  db.query(
    `
      INSERT INTO activities (
        id, account_id, asset_id, activity_type, subtype, status, activity_date,
        quantity, unit_price, amount, fee, currency, fx_rate, notes, metadata,
        source_system, source_record_id, source_group_id, idempotency_key, import_run_id,
        is_user_modified, needs_review, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    activity.id,
    activity.accountId ?? "account-1",
    activity.assetId ?? null,
    activity.activityType ?? "BUY",
    activity.subtype ?? null,
    activity.status ?? "POSTED",
    activity.activityDate ?? "2024-01-01T00:00:00Z",
    activity.quantity ?? null,
    activity.unitPrice ?? null,
    activity.amount ?? null,
    activity.fee ?? null,
    activity.currency ?? "USD",
    activity.fxRate ?? null,
    activity.notes ?? null,
    activity.metadata ?? null,
    activity.sourceSystem ?? "MANUAL",
    activity.sourceRecordId ?? null,
    activity.sourceGroupId ?? null,
    activity.idempotencyKey ?? null,
    activity.importRunId ?? null,
    activity.isUserModified ? 1 : 0,
    activity.needsReview ? 1 : 0,
    activity.createdAt ?? "2024-01-01T00:00:00Z",
    activity.updatedAt ?? "2024-01-01T00:00:00Z",
  );
}

function readActivityValue(
  db: Database,
  activityId: string,
  column: "id" | "source_group_id",
): string | null {
  const row = db
    .query<
      { value: string | null },
      [string]
    >(`SELECT ${column} AS value FROM activities WHERE id = ?`)
    .get(activityId);
  return row?.value ?? null;
}

function readLinkId(db: Database, accountId: string, contextKind: string): string | null {
  return readLinkValue(db, accountId, contextKind, "id");
}

function readLinkedTemplateId(db: Database, accountId: string, contextKind: string): string | null {
  return readLinkValue(db, accountId, contextKind, "template_id");
}

function readLinkValue(
  db: Database,
  accountId: string,
  contextKind: string,
  column: "id" | "template_id",
): string | null {
  const row = db
    .query<
      { value: string },
      [string, string]
    >(`SELECT ${column} AS value FROM import_account_templates WHERE account_id = ? AND context_kind = ?`)
    .get(accountId, contextKind);
  return row?.value ?? null;
}

function readTemplateConfig(db: Database, templateId: string): string {
  const row = db
    .query<{ config: string }, [string]>("SELECT config FROM import_templates WHERE id = ?")
    .get(templateId);
  if (!row) {
    throw new Error(`Missing template ${templateId}`);
  }
  return row.config;
}
