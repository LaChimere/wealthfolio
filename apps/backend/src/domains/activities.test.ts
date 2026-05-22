import { Database } from "bun:sqlite";
import { describe, expect, test } from "bun:test";

import {
  ACTIVITIES_CHANGED_EVENT,
  createActivityService,
  shouldQueueActivitySyncEvent,
  type Activity,
  type ActivityBulkMutationResult,
  type ActivitySearchRequest,
  type ActivitySyncEvent,
} from "./activities";
import type { BackendEvent, BackendEventBus } from "../events";

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

  test("parses activity CSV files with Rust-compatible detection and row normalization", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      const parsed = service.parseCsv?.({
        content: new TextEncoder().encode(
          "\uFEFFName;Amount;Note\nAlice;10;ok\nBob;20;extra;ignored\n",
        ),
        config: { delimiter: "auto" },
      });

      expect(parsed).toMatchObject({
        headers: ["Name", "Amount", "Note"],
        rows: [
          ["Alice", "10", "ok"],
          ["Bob", "20", "extra"],
        ],
        detectedConfig: {
          delimiter: ";",
          hasHeaderRow: true,
          headerRowIndex: 0,
          skipTopRows: 0,
          skipBottomRows: 0,
          skipEmptyRows: true,
          quoteChar: '"',
        },
        errors: [
          {
            rowIndex: null,
            columnIndex: null,
            message: "Row 2 has 4 columns, expected 3. Extra columns ignored.",
            errorType: "structure",
          },
        ],
        rowCount: 2,
      });

      const tabDelimited = service.parseCsv?.({
        content: new TextEncoder().encode("A\t1\nB\t2"),
        config: { hasHeaderRow: false, delimiter: "\\t" },
      });

      expect(tabDelimited).toMatchObject({
        headers: ["Column1", "Column2"],
        rows: [
          ["A", "1"],
          ["B", "2"],
        ],
        detectedConfig: { delimiter: "\t", hasHeaderRow: false },
        errors: [],
        rowCount: 2,
      });

      const utf16 = service.parseCsv?.({
        content: utf16LeWithBom("Name,City\nAlice,Zürich"),
        config: {},
      });
      expect(utf16).toMatchObject({
        headers: ["Name", "City"],
        rows: [["Alice", "Zürich"]],
        errors: [],
        rowCount: 1,
      });

      const windows1252 = service.parseCsv?.({
        content: new Uint8Array([0x4e, 0x61, 0x6d, 0x65, 0x0a, 0x63, 0x61, 0x66, 0xe9]),
        config: {},
      });
      expect(windows1252).toMatchObject({
        headers: ["Name"],
        rows: [["café"]],
        errors: [
          {
            rowIndex: null,
            columnIndex: null,
            errorType: "encoding",
          },
        ],
        rowCount: 1,
      });

      expect(() =>
        service.parseCsv?.({
          content: new TextEncoder().encode(""),
          config: {},
        }),
      ).toThrow("CSV file is empty or contains no valid records");
      expect(() =>
        service.parseCsv?.({
          content: new TextEncoder().encode("a,b"),
          config: { skipTopRows: 1 },
        }),
      ).toThrow("Cannot skip 1 rows from a file with 1 rows");
    } finally {
      db.close();
    }
  });

  test("previews import assets with existing matches and bounded new-asset drafts", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
      insertAsset(db, { id: "dup-1", displayCode: "DUP", name: "Duplicate One" });
      insertAsset(db, { id: "dup-2", displayCode: "DUP", name: "Duplicate Two" });

      expect(
        await service.previewImportAssets?.([
          {
            key: "existing",
            accountId: "account-1",
            symbol: "aapl",
            exchangeMic: "XNAS",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
          },
          {
            key: "missing-exchange",
            accountId: "account-1",
            symbol: "SHOP",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          },
          {
            key: "manual",
            accountId: "account-1",
            symbol: "PRIVATE",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
            quoteMode: "MANUAL",
          },
          {
            key: "manual-lowercase",
            accountId: "account-1",
            symbol: "PRIVATE_LOWER",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
            quoteMode: "manual",
          },
          {
            key: "manual-padded",
            accountId: "account-1",
            symbol: "PRIVATE_PADDED",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
            quoteMode: " MANUAL ",
          },
          {
            key: "ambiguous",
            accountId: "account-1",
            symbol: "DUP",
          },
          {
            key: "missing-account",
            symbol: "MSFT",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
          },
          {
            key: "garbage-symbol",
            accountId: "account-1",
            symbol: "$FOO",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
          },
        ]),
      ).toEqual([
        {
          key: "existing",
          status: "EXISTING_ASSET",
          resolutionSource: "existing_asset",
          assetId: "AAPL",
          draft: expect.objectContaining({
            id: "AAPL",
            displayCode: "AAPL",
            instrumentSymbol: "AAPL",
            instrumentExchangeMic: "XNAS",
            quoteCcy: "USD",
          }),
        },
        {
          key: "missing-exchange",
          status: "NEEDS_FIXING",
          resolutionSource: "missing_exchange",
          draft: expect.objectContaining({
            displayCode: "SHOP",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          }),
          errors: {
            symbol: [
              "Could not determine the exchange for 'SHOP'. Please search for the correct ticker.",
            ],
          },
        },
        {
          key: "manual",
          status: "AUTO_RESOLVED_NEW_ASSET",
          resolutionSource: "provider_resolution",
          draft: expect.objectContaining({
            displayCode: "PRIVATE",
            quoteMode: "MANUAL",
            instrumentType: "EQUITY",
          }),
        },
        {
          key: "manual-lowercase",
          status: "AUTO_RESOLVED_NEW_ASSET",
          resolutionSource: "provider_resolution",
          draft: expect.objectContaining({
            displayCode: "PRIVATE_LOWER",
            quoteMode: "MARKET",
            instrumentType: "EQUITY",
          }),
        },
        {
          key: "manual-padded",
          status: "NEEDS_FIXING",
          resolutionSource: "missing_exchange",
          draft: expect.objectContaining({
            displayCode: "PRIVATE_PADDED",
            quoteMode: "MARKET",
            instrumentType: "EQUITY",
          }),
          errors: {
            symbol: [
              "Could not determine the exchange for 'PRIVATE_PADDED'. Please search for the correct ticker.",
            ],
          },
        },
        {
          key: "ambiguous",
          status: "NEEDS_FIXING",
          resolutionSource: "ambiguous_existing_asset",
          errors: {
            symbol: [
              "Multiple existing assets match symbol DUP; provide asset.id or more disambiguation",
            ],
          },
        },
        {
          key: "missing-account",
          status: "NEEDS_FIXING",
          resolutionSource: "validation_error",
          errors: {
            accountId: ["Account is required before running backend validation."],
          },
        },
        {
          key: "garbage-symbol",
          status: "NEEDS_FIXING",
          resolutionSource: "validation_error",
          errors: {
            symbol: ["Invalid symbol '$FOO'. Please correct or remove it."],
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("previews import assets by matching yahoo-suffixed symbols to existing assets", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XETR", "EUR"]]),
        yahooSuffixToMic: new Map([["DE", "XETR"]]),
      },
      symbolSearch() {
        throw new Error("provider should not be called for suffix-normalized existing assets");
      },
    });

    try {
      insertAccount(db, { id: "account-eur", name: "Euro", currency: "EUR" });
      insertAsset(db, {
        id: "BASF",
        displayCode: "BASF",
        name: "BASF SE",
        quoteCcy: "EUR",
        instrumentSymbol: "DE000BASF111",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
      });

      expect(
        await service.previewImportAssets?.([
          {
            key: "basf",
            accountId: "account-eur",
            symbol: "de000basf111.de",
          },
        ]),
      ).toEqual([
        {
          key: "basf",
          status: "EXISTING_ASSET",
          resolutionSource: "existing_asset",
          assetId: "BASF",
          draft: expect.objectContaining({
            id: "BASF",
            displayCode: "BASF",
            instrumentSymbol: "DE000BASF111",
            instrumentExchangeMic: "XETR",
            quoteCcy: "EUR",
          }),
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("previews import assets with provider-backed exchange resolution", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([
          ["XNYS", "USD"],
          ["XTSE", "CAD"],
        ]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        if (query === "SHOP") {
          return [
            {
              symbol: "SHOP",
              shortName: "Shopify US",
              longName: "Shopify US",
              exchange: "NYSE",
              exchangeMic: "XNYS",
              exchangeName: "NYSE",
              quoteType: "EQUITY",
              typeDisplay: "",
              currency: "USD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        if (query === "SHOP.TO") {
          return [
            {
              symbol: "SHOP.TO",
              shortName: "Shopify Canada",
              longName: "Shopify Canada",
              exchange: "TOR",
              exchangeMic: "XTSE",
              exchangeName: "TSX",
              quoteType: "EQUITY",
              typeDisplay: "",
              currency: "CAD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      expect(
        await service.previewImportAssets?.([
          {
            key: "shop",
            accountId: "account-cad",
            symbol: "SHOP",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          },
        ]),
      ).toEqual([
        {
          key: "shop",
          status: "AUTO_RESOLVED_NEW_ASSET",
          resolutionSource: "provider_resolution",
          draft: expect.objectContaining({
            name: "Shopify Canada",
            displayCode: "SHOP",
            instrumentSymbol: "SHOP",
            instrumentExchangeMic: "XTSE",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          }),
        },
      ]);
      expect(calls).toEqual(["SHOP", "SHOP.TO"]);
    } finally {
      db.close();
    }
  });

  test("previews import assets without overwriting explicit exchange MIC", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      symbolSearch(query) {
        calls.push(query);
        return [
          {
            symbol: "AAPL",
            shortName: "Apple NYSE",
            longName: "Apple NYSE",
            exchange: "NYSE",
            exchangeMic: "XNYS",
            exchangeName: "NYSE",
            quoteType: "EQUITY",
            typeDisplay: "",
            currency: "USD",
            dataSource: "YAHOO",
            isExisting: false,
            index: "",
            score: 1,
          },
        ];
      },
    });

    try {
      insertAccount(db, { id: "account-usd", name: "US", currency: "USD" });

      expect(
        await service.previewImportAssets?.([
          {
            key: "aapl",
            accountId: "account-usd",
            symbol: "AAPL",
            exchangeMic: "XNAS",
            quoteCcy: "USD",
          },
        ]),
      ).toEqual([
        {
          key: "aapl",
          status: "AUTO_RESOLVED_NEW_ASSET",
          resolutionSource: "provider_resolution",
          draft: expect.objectContaining({
            displayCode: "AAPL",
            instrumentSymbol: "AAPL",
            instrumentExchangeMic: "XNAS",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
          }),
        },
      ]);
      expect(calls).toEqual(["AAPL"]);
    } finally {
      db.close();
    }
  });

  test("previews import assets with existing ISIN-backed asset resolution", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db, {
      symbolSearch() {
        throw new Error("provider should not be called for existing ISIN assets");
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });
      insertAsset(db, {
        id: "SHOP-CA",
        displayCode: "SHOP",
        name: "Shopify Canada",
        quoteCcy: "CAD",
        instrumentSymbol: "SHOP",
        exchangeMic: "XTSE",
        instrumentType: "EQUITY",
        notes: "local note",
        metadata: JSON.stringify({ identifiers: { isin: "CA82509L1076" } }),
        providerConfig: JSON.stringify({ preferred_provider: "YAHOO" }),
      });

      expect(
        await service.previewImportAssets?.([
          {
            key: "shop",
            accountId: "account-cad",
            symbol: "SHOP",
            isin: " ca82509l1076 ",
          },
        ]),
      ).toEqual([
        {
          key: "shop",
          status: "EXISTING_ASSET",
          resolutionSource: "existing_asset",
          assetId: "SHOP-CA",
          draft: expect.objectContaining({
            name: "Shopify Canada",
            displayCode: "SHOP",
            instrumentSymbol: "SHOP",
            instrumentExchangeMic: "XTSE",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
            providerConfig: { preferred_provider: "YAHOO" },
            notes: "local note",
            metadata: { identifiers: { isin: "CA82509L1076" } },
          }),
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("previews import assets by searching ISIN before ticker fallback", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XTSE", "CAD"]]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        if (query === "CA0000000002") {
          return [
            {
              symbol: "BOND1",
              shortName: "Bond by ISIN",
              longName: "Bond by ISIN",
              exchange: "TOR",
              exchangeMic: "XTSE",
              exchangeName: "TSX",
              quoteType: "BOND",
              typeDisplay: "",
              currency: "CAD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      expect(
        await service.previewImportAssets?.([
          {
            key: "shop",
            accountId: "account-cad",
            symbol: "BOND1",
            isin: "CA0000000002",
          },
        ]),
      ).toEqual([
        {
          key: "shop",
          status: "AUTO_RESOLVED_NEW_ASSET",
          resolutionSource: "provider_resolution",
          draft: expect.objectContaining({
            id: null,
            name: "Bond by ISIN",
            displayCode: "BOND1",
            instrumentSymbol: "BOND1",
            instrumentExchangeMic: "XTSE",
            instrumentType: "BOND",
            quoteCcy: "CAD",
            providerConfig: null,
            notes: null,
            metadata: null,
          }),
        },
      ]);
      expect(calls).toEqual(["CA0000000002"]);
    } finally {
      db.close();
    }
  });

  test("previews import assets without local symbol fallback for mismatched ISIN", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XTSE", "CAD"]]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });
      insertAsset(db, {
        id: "SHOP-CA",
        displayCode: "SHOP",
        name: "Shopify Canada",
        quoteCcy: "CAD",
        instrumentSymbol: "SHOP",
        exchangeMic: "XTSE",
        instrumentType: "EQUITY",
        metadata: JSON.stringify({ identifiers: { isin: "CA82509L1076" } }),
      });

      expect(
        await service.previewImportAssets?.([
          {
            key: "shop",
            accountId: "account-cad",
            symbol: "SHOP",
            isin: "CA82509L9999",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          },
        ]),
      ).toEqual([
        {
          key: "shop",
          status: "NEEDS_FIXING",
          resolutionSource: "missing_exchange",
          draft: expect.objectContaining({
            displayCode: "SHOP",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          }),
          errors: {
            symbol: [
              "Could not determine the exchange for 'SHOP'. Please search for the correct ticker.",
            ],
          },
        },
      ]);
      expect(calls).toEqual(["CA82509L9999", "SHOP", "SHOP.TO"]);
    } finally {
      db.close();
    }
  });

  test("previews import assets as missing exchange when provider returns no MIC", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XTSE", "CAD"]]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch() {
        return [
          {
            symbol: "MISSING",
            shortName: "Missing MIC",
            longName: "Missing MIC",
            exchange: "",
            exchangeMic: null,
            exchangeName: null,
            quoteType: "EQUITY",
            typeDisplay: "",
            currency: null,
            dataSource: "YAHOO",
            isExisting: false,
            index: "",
            score: 0,
          },
        ];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      expect(
        await service.previewImportAssets?.([
          {
            key: "missing",
            accountId: "account-cad",
            symbol: "MISSING",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          },
        ]),
      ).toEqual([
        {
          key: "missing",
          status: "NEEDS_FIXING",
          resolutionSource: "missing_exchange",
          draft: expect.objectContaining({
            displayCode: "MISSING",
            instrumentType: "EQUITY",
            quoteCcy: "CAD",
          }),
          errors: {
            symbol: [
              "Could not determine the exchange for 'MISSING'. Please search for the correct ticker.",
            ],
          },
        },
      ]);
    } finally {
      db.close();
    }
  });

  test("checks import activities with provider-backed exchange resolution", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([
          ["XNYS", "USD"],
          ["XTSE", "CAD"],
        ]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        if (query === "SHOP") {
          return [
            {
              symbol: "SHOP",
              shortName: "Shopify US",
              longName: "Shopify US",
              exchange: "NYSE",
              exchangeMic: "XNYS",
              exchangeName: "NYSE",
              quoteType: "EQUITY",
              typeDisplay: "",
              currency: "USD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        if (query === "SHOP.TO") {
          return [
            {
              symbol: "SHOP.TO",
              shortName: "Shopify Canada",
              longName: "Shopify Canada",
              exchange: "TOR",
              exchangeMic: "XTSE",
              exchangeName: "TSX",
              quoteType: "EQUITY",
              typeDisplay: "",
              currency: "CAD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "SHOP",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 1,
        },
      ])) as Array<Record<string, unknown>>;
      const checkedAssetId = checked[0]?.assetId as string;

      expect(checked).toHaveLength(1);
      expect(checked[0]).toMatchObject({
        accountId: "account-cad",
        accountName: "Canadian",
        symbol: "SHOP",
        symbolName: "Shopify Canada",
        exchangeMic: "XTSE",
        instrumentType: "EQUITY",
        quoteCcy: "CAD",
        isValid: true,
      });
      expect(checkedAssetId).toBeString();
      expect(checked[0]).not.toHaveProperty("errors");
      expect(readAssetCount(db)).toBe(0);

      const result = (await service.importActivities?.(checked)) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({
        imported: 1,
        assetsCreated: 1,
        success: true,
      });
      expect(result.activities[0]?.assetId).toBe(checkedAssetId);
      expect(readAssetById(db, checkedAssetId)).toMatchObject({
        name: "Shopify Canada",
        display_code: "SHOP",
        instrument_symbol: "SHOP",
        instrument_exchange_mic: "XTSE",
        instrument_type: "EQUITY",
        quote_ccy: "CAD",
        quote_mode: "MARKET",
      });
      expect(calls).toEqual(["SHOP", "SHOP.TO"]);
    } finally {
      db.close();
    }
  });

  test("checks and imports yahoo-suffixed symbols by matching existing assets before providers", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XETR", "EUR"]]),
        yahooSuffixToMic: new Map([["DE", "XETR"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-eur", name: "Euro", currency: "EUR" });
      insertAsset(db, {
        id: "BASF",
        displayCode: "BASF",
        name: "BASF SE",
        quoteCcy: "EUR",
        instrumentSymbol: "DE000BASF111",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
      });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-eur",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "de000basf111.de",
          quantity: "1",
          unitPrice: "50",
          amount: "50",
          currency: "EUR",
          lineNumber: 1,
        },
      ])) as Array<Record<string, unknown>>;

      expect(checked).toHaveLength(1);
      expect(checked[0]).toMatchObject({
        assetId: "BASF",
        symbol: "de000basf111",
        symbolName: "BASF SE",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
        quoteCcy: "EUR",
        isValid: true,
      });
      expect(checked[0]).not.toHaveProperty("errors");
      expect(calls).toEqual([]);

      const result = (await service.importActivities?.(checked)) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({
        imported: 1,
        assetsCreated: 0,
        success: true,
      });
      expect(result.activities[0]?.assetId).toBe("BASF");
      expect(readAssetCount(db)).toBe(1);
      expect(calls).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("imports symbol-only activities with provider-backed exchange resolution", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([
          ["XNYS", "USD"],
          ["XTSE", "CAD"],
        ]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        if (query === "SHOP") {
          return [
            {
              symbol: "SHOP",
              shortName: "Shopify US",
              longName: "Shopify US",
              exchange: "NYSE",
              exchangeMic: "XNYS",
              exchangeName: "NYSE",
              quoteType: "EQUITY",
              typeDisplay: "",
              currency: "USD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        if (query === "SHOP.TO") {
          return [
            {
              symbol: "SHOP.TO",
              shortName: "Shopify Canada",
              longName: "Shopify Canada",
              exchange: "TOR",
              exchangeMic: "XTSE",
              exchangeName: "TSX",
              quoteType: "EQUITY",
              typeDisplay: "",
              currency: "CAD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      const result = (await service.importActivities?.([
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "SHOP",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 1,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      const assetId = result.activities[0]?.assetId as string;
      expect(assetId).toBeString();
      expect(result.summary).toMatchObject({
        imported: 1,
        assetsCreated: 1,
        success: true,
      });
      expect(result.activities[0]).toMatchObject({
        symbol: "SHOP",
        symbolName: "Shopify Canada",
        exchangeMic: "XTSE",
        instrumentType: "EQUITY",
        quoteCcy: "CAD",
        isValid: true,
      });
      expect(readAssetById(db, assetId)).toMatchObject({
        name: "Shopify Canada",
        display_code: "SHOP",
        instrument_symbol: "SHOP",
        instrument_exchange_mic: "XTSE",
        instrument_type: "EQUITY",
        quote_ccy: "CAD",
        quote_mode: "MARKET",
      });
      expect(calls).toEqual(["SHOP", "SHOP.TO"]);
    } finally {
      db.close();
    }
  });

  test("checks import activities with existing ISIN-backed asset resolution", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      symbolSearch(query) {
        calls.push(query);
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });
      insertAsset(db, {
        id: "SHOP-CA",
        displayCode: "SHOP",
        name: "Shopify Canada",
        quoteCcy: "CAD",
        instrumentSymbol: "SHOP",
        exchangeMic: "XTSE",
        instrumentType: "EQUITY",
        metadata: JSON.stringify({ identifiers: { isin: "CA82509L1076" } }),
      });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "SHOP",
          isin: " ca82509l1076 ",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 1,
        },
      ])) as Array<Record<string, unknown>>;

      expect(checked[0]).toMatchObject({
        assetId: "SHOP-CA",
        symbol: "SHOP",
        symbolName: "Shopify Canada",
        exchangeMic: "XTSE",
        instrumentType: "EQUITY",
        quoteCcy: "CAD",
        isValid: true,
      });
      expect(calls).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("checks import activities by searching ISIN before ticker fallback", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XTSE", "CAD"]]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        if (query === "CA0000000001") {
          return [
            {
              symbol: "BOND1",
              shortName: "Bond by ISIN",
              longName: "Bond by ISIN",
              exchange: "TOR",
              exchangeMic: "XTSE",
              exchangeName: "TSX",
              quoteType: "BOND",
              typeDisplay: "",
              currency: "CAD",
              dataSource: "YAHOO",
              isExisting: false,
              index: "",
              score: 1,
            },
          ];
        }
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "BOND1",
          isin: "CA0000000001",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 1,
        },
      ])) as Array<Record<string, unknown>>;

      expect(checked[0]).toMatchObject({
        symbol: "BOND1",
        symbolName: "Bond by ISIN",
        exchangeMic: "XTSE",
        instrumentType: "BOND",
        quoteCcy: "CAD",
        isValid: true,
      });
      expect(calls).toEqual(["CA0000000001"]);
    } finally {
      db.close();
    }
  });

  test("keeps import validation invalid when provider resolution has no MIC", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XTSE", "CAD"]]),
        yahooSuffixToMic: new Map([["TO", "XTSE"]]),
      },
      symbolSearch(query) {
        calls.push(query);
        return [
          {
            symbol: query,
            shortName: "Missing MIC",
            longName: "Missing MIC",
            exchange: "",
            exchangeMic: null,
            exchangeName: null,
            quoteType: "EQUITY",
            typeDisplay: "",
            currency: null,
            dataSource: "YAHOO",
            isExisting: false,
            index: "",
            score: 0,
          },
        ];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "MISSING",
          instrumentType: "EQUITY",
          quoteCcy: "CAD",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 1,
        },
      ])) as Array<Record<string, unknown>>;

      expect(checked).toEqual([
        expect.objectContaining({
          isValid: false,
          errors: {
            symbol: [
              "Could not find 'MISSING' in market data. Please search for the correct ticker symbol.",
            ],
          },
        }),
      ]);
      expect(calls).toEqual(["MISSING", "MISSING.TO"]);
    } finally {
      db.close();
    }
  });

  test("does not provider-resolve manual quoted import assets", async () => {
    const db = createActivitiesDb();
    const calls: string[] = [];
    const service = createActivityService(db, {
      symbolSearch(query) {
        calls.push(query);
        return [];
      },
    });

    try {
      insertAccount(db, { id: "account-cad", name: "Canadian", currency: "CAD" });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "PRIVATE",
          instrumentType: "EQUITY",
          quoteCcy: "CAD",
          quoteMode: "MANUAL",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 1,
        },
        {
          accountId: "account-cad",
          activityType: "BUY",
          date: "2025-01-16",
          symbol: "PADDED",
          instrumentType: "EQUITY",
          quoteCcy: "CAD",
          quoteMode: " MANUAL ",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "CAD",
          lineNumber: 2,
        },
      ])) as Array<Record<string, unknown>>;

      expect(checked[0]).toMatchObject({
        symbol: "PRIVATE",
        quoteMode: "MANUAL",
        isValid: true,
      });
      expect(checked[0]?.assetId).toBeString();
      expect(checked[1]).toMatchObject({
        symbol: "PADDED",
        quoteMode: " MANUAL ",
        isValid: false,
        errors: {
          symbol: [
            "Could not find 'PADDED' in market data. Please search for the correct ticker symbol.",
          ],
        },
      });
      expect(calls).toEqual(["PADDED"]);
    } finally {
      db.close();
    }
  });

  test("checks import activities read-only with asset resolution and duplicate warnings", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
      const existing = service.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "aapl",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          isDraft: true,
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-16",
          amount: "25",
          currency: "USD",
          isDraft: true,
          lineNumber: 2,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-16",
          amount: "25",
          currency: "USD",
          isDraft: true,
          lineNumber: 3,
        },
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-17",
          symbol: "UNKNOWN",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          isDraft: true,
          lineNumber: 4,
        },
        {
          activityType: "DEPOSIT",
          date: "2025-01-18",
          amount: "10",
          isDraft: true,
          lineNumber: 5,
        },
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-19",
          symbol: "$FOO",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          isDraft: true,
          lineNumber: 6,
        },
      ]);

      expect(checked).toHaveLength(6);
      expect(checked?.[0]).toMatchObject({
        accountId: "account-1",
        accountName: "Alpha",
        assetId: "AAPL",
        isValid: true,
        duplicateOfId: existing.id,
        warnings: { _duplicate: ["Duplicate activity already exists"] },
      });
      expect(checked?.[1]).toMatchObject({
        accountId: "account-1",
        accountName: "Alpha",
        symbol: "",
        isValid: true,
      });
      expect(checked?.[1]).not.toHaveProperty("errors");
      expect(checked?.[1]).not.toHaveProperty("warnings");
      expect(checked?.[2]).toMatchObject({
        accountId: "account-1",
        accountName: "Alpha",
        symbol: "",
        isValid: true,
        duplicateOfLineNumber: 2,
        warnings: { _duplicate: ["Duplicate of line 2 in this import batch"] },
      });
      expect(checked?.[3]).toMatchObject({
        accountId: "account-1",
        accountName: "Alpha",
        isValid: true,
        symbol: "UNKNOWN",
      });
      expect(checked?.[3]?.assetId).toBeString();
      expect(checked?.[3]).not.toHaveProperty("errors");
      expect(checked?.[4]).toMatchObject({
        isValid: false,
        errors: { accountId: ["Account is required before running backend validation."] },
      });
      expect(checked?.[5]).toMatchObject({
        isValid: false,
        errors: { symbol: ["Invalid symbol '$FOO'. Please correct or remove it."] },
      });
      expect(readActivityCount(db)).toBe(1);
      expect(readAssetCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  test("hydrates import activities from existing asset ids like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-eur", name: "Euro", currency: "EUR" });
      insertAsset(db, {
        id: "BASF",
        displayCode: "BASF",
        name: "BASF SE",
        quoteCcy: "EUR",
        instrumentSymbol: "DE000BASF111",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
      });

      const checked = (await service.checkActivitiesImport?.([
        {
          accountId: "account-eur",
          assetId: "BASF",
          activityType: "BUY",
          date: "2025-01-15",
          quantity: "1",
          unitPrice: "50",
          amount: "50",
          lineNumber: 1,
        },
      ])) as Array<Record<string, unknown>>;

      expect(checked).toHaveLength(1);
      expect(checked[0]).toMatchObject({
        accountId: "account-eur",
        accountName: "Euro",
        assetId: "BASF",
        symbol: "BASF",
        symbolName: "BASF SE",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
        quoteMode: "MARKET",
        quoteCcy: "EUR",
        currency: "EUR",
        isValid: true,
      });
      expect(checked[0]).not.toHaveProperty("errors");
    } finally {
      db.close();
    }
  });

  test("validates import activity currency codes like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-15",
          amount: "10",
          currency: "US1",
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-16",
          amount: "10",
          currency: "EUR",
          lineNumber: 2,
        },
      ]);

      expect(checked?.[0]).toMatchObject({
        isValid: false,
        errors: {
          currency: ["Invalid currency code: USD or US1"],
        },
      });
      expect(checked?.[1]).toMatchObject({
        currency: "EUR",
        isValid: true,
      });
      expect(checked?.[1]).not.toHaveProperty("errors");
    } finally {
      db.close();
    }
  });

  test("canonicalizes and clears import activity subtypes like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "DIVIDEND",
          subtype: "drip",
          date: "2025-01-15",
          symbol: "AAPL",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          subtype: "deposit",
          date: "2025-01-16",
          amount: "10",
          currency: "USD",
          lineNumber: 2,
        },
      ]);

      expect(checked?.[0]).toMatchObject({
        subtype: "DRIP",
        assetId: "AAPL",
        isValid: true,
      });
      expect(checked?.[0]).not.toHaveProperty("errors");
      expect(checked?.[1]).toMatchObject({
        symbol: "",
        isValid: true,
      });
      expect(checked?.[1]).not.toHaveProperty("subtype");
      expect(checked?.[1]).not.toHaveProperty("errors");
    } finally {
      db.close();
    }
  });

  test("clears duplicate import subtypes during apply like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          subtype: "deposit",
          date: "2025-01-16",
          amount: "10",
          currency: "USD",
          lineNumber: 1,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({ imported: 1, success: true });
      expect(result.activities[0]).toMatchObject({
        symbol: "",
        isValid: true,
      });
      expect(result.activities[0]).not.toHaveProperty("subtype");
      expect(readActivityValue(db, result.activities[0]?.id as string, "subtype")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("falls back to account currency for invalid split import apply currencies like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          assetId: "AAPL",
          activityType: "SPLIT",
          date: "2025-01-16",
          amount: "2",
          currency: "$$",
          lineNumber: 1,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({ imported: 1, success: true });
      expect(result.activities[0]).toMatchObject({
        assetId: "AAPL",
        currency: "USD",
        isValid: true,
      });
      expect(readActivityValue(db, result.activities[0]?.id as string, "currency")).toBe("USD");
    } finally {
      db.close();
    }
  });

  test("validates empty import symbols for asset-backed activity rows like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "SPLIT",
          date: "2025-01-16",
          symbol: "   ",
          amount: "2",
          currency: "USD",
          lineNumber: 2,
        },
        {
          accountId: "account-1",
          activityType: "DIVIDEND",
          subtype: "DRIP",
          date: "2025-01-17",
          symbol: "",
          quantity: "1",
          unitPrice: "1",
          amount: "1",
          currency: "USD",
          lineNumber: 3,
        },
        {
          accountId: "account-1",
          assetId: "AAPL",
          activityType: "BUY",
          date: "2025-01-18",
          symbol: "",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          lineNumber: 4,
        },
      ]);

      expect(checked?.[0]).toMatchObject({
        isValid: false,
        errors: { symbol: ["Symbol is required for BUY activities."] },
      });
      expect(checked?.[1]).toMatchObject({
        isValid: false,
        errors: { symbol: ["Symbol is required for SPLIT activities."] },
      });
      expect(checked?.[2]).toMatchObject({
        isValid: false,
        errors: { symbol: ["Symbol is required for DIVIDEND activities."] },
      });
      expect(checked?.[3]).toMatchObject({
        assetId: "AAPL",
        symbol: "AAPL",
        isValid: true,
      });
      expect(checked?.[3]).not.toHaveProperty("errors");
    } finally {
      db.close();
    }
  });

  test("fills import symbol names from normalized symbols for new assets like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "MSFT",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          lineNumber: 1,
        },
      ]);

      expect(checked?.[0]).toMatchObject({
        symbol: "MSFT",
        symbolName: "MSFT",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
        quoteCcy: "USD",
        isValid: true,
      });
      expect(checked?.[0]?.assetId).toBeString();
      expect(checked?.[0]).not.toHaveProperty("errors");
      expect(readAssetCount(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  test("hydrates staged import asset fields from normalized symbols like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XETR", "EUR"]]),
        yahooSuffixToMic: new Map([["DE", "XETR"]]),
      },
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "sap.de",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          lineNumber: 1,
        },
      ]);

      expect(checked?.[0]).toMatchObject({
        symbol: "sap",
        symbolName: "sap",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
        quoteCcy: "EUR",
        currency: "USD",
        isValid: true,
      });
      expect(checked?.[0]?.assetId).toBeString();
      expect(checked?.[0]).not.toHaveProperty("errors");
      expect(readAssetCount(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  test("classifies import symbols with Rust-compatible optional asset rules", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      const checked = await service.checkActivitiesImport?.([
        {
          accountId: "account-1",
          activityType: "DIVIDEND",
          date: "2025-01-20",
          symbol: "$FOO",
          amount: "3",
          currency: "USD",
          isDraft: true,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-21",
          symbol: "AAPL",
          amount: "25",
          currency: "USD",
          isDraft: true,
        },
        {
          accountId: "account-1",
          activityType: "TRANSFER_IN",
          date: "2025-01-22",
          symbol: "AAPL",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quantity: "1",
          unitPrice: "10",
          currency: "USD",
          isDraft: true,
        },
        {
          accountId: "account-1",
          activityType: "TRANSFER_OUT",
          date: "2025-01-23",
          symbol: "AAPL",
          amount: "10",
          currency: "USD",
          isDraft: true,
        },
      ]);

      expect(checked?.[0]).toMatchObject({
        isValid: true,
        symbol: "",
      });
      expect(checked?.[0]?.assetId).toBeUndefined();
      expect(checked?.[1]).toMatchObject({
        isValid: true,
        symbol: "",
      });
      expect(checked?.[1]?.assetId).toBeUndefined();
      expect(checked?.[2]).toMatchObject({
        isValid: true,
        symbol: "AAPL",
        assetId: "AAPL",
      });
      expect(checked?.[3]).toMatchObject({
        isValid: false,
        errors: {
          symbol: [
            "Symbol 'AAPL' on TRANSFER_OUT with no quantity or price. Remove the symbol for a cash transfer, or add quantity for an asset transfer.",
          ],
        },
      });
      expect(readActivityCount(db)).toBe(0);
      expect(readAssetCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  test("applies import symbol disposition before writing activities", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DIVIDEND",
          date: "2025-01-20",
          symbol: "$FOO",
          amount: "3",
          currency: "USD",
          isDraft: false,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-21",
          symbol: "AAPL",
          amount: "25",
          currency: "USD",
          isDraft: false,
        },
        {
          accountId: "account-1",
          activityType: "TRANSFER_IN",
          date: "2025-01-22",
          symbol: "AAPL",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quantity: "1",
          unitPrice: "10",
          currency: "USD",
          isDraft: false,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({ total: 3, imported: 3, success: true });
      const dividendId = result.activities[0]?.id as string;
      const depositId = result.activities[1]?.id as string;
      const transferId = result.activities[2]?.id as string;
      expect(readActivityValue(db, dividendId, "asset_id")).toBeNull();
      expect(readActivityValue(db, depositId, "asset_id")).toBeNull();
      expect(readActivityValue(db, transferId, "asset_id")).toBe("AAPL");
    } finally {
      db.close();
    }
  });

  test("imports checked activities with import run metadata", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "USD",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          assetId: "AAPL",
          activityType: "BUY",
          date: "2025-01-15",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-16",
          amount: "25",
          currency: "USD",
          isDraft: true,
          lineNumber: 2,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        importRunId: string;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({
        total: 2,
        imported: 2,
        skipped: 0,
        duplicates: 0,
        assetsCreated: 0,
        success: true,
        errorMessage: null,
      });
      expect(result.importRunId).toBeString();
      expect(result.importRunId).not.toBe("");
      expect(result.activities).toHaveLength(2);
      expect(result.activities[0]).toMatchObject({
        accountId: "account-1",
        assetId: "AAPL",
        isValid: true,
      });
      expect(result.activities[1]).toMatchObject({
        accountId: "account-1",
        symbol: "",
        isValid: true,
      });
      const buyId = result.activities[0]?.id as string;
      const depositId = result.activities[1]?.id as string;
      expect(readActivityValue(db, buyId, "import_run_id")).toBe(result.importRunId);
      expect(readActivityValue(db, buyId, "source_system")).toBe("CSV");
      expect(readActivityValue(db, depositId, "status")).toBe("DRAFT");
      expect(readImportRun(db, result.importRunId)).toMatchObject({
        account_id: "account-1",
        source_system: "csv",
        run_type: "IMPORT",
        mode: "INCREMENTAL",
        status: "APPLIED",
        review_mode: "NEVER",
      });
      expect(readImportRunSummary(db, result.importRunId)).toMatchObject({
        fetched: 2,
        inserted: 2,
        skipped: 0,
        assetsCreated: 0,
      });
    } finally {
      db.close();
    }
  });

  test("imports activities with new symbol assets", async () => {
    const db = createActivitiesDb();
    const events: BackendEvent[] = [];
    const service = createActivityService(db, { eventBus: recordingEventBus(events) });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const rows = [
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "NVDA",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quoteMode: "MANUAL",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "USD",
          lineNumber: 1,
        },
      ];
      const checked = (await service.checkActivitiesImport?.(rows)) as Array<
        Record<string, unknown>
      >;
      const checkedAssetId = checked[0]?.assetId as string;
      expect(checkedAssetId).toBeString();
      expect(checked[0]?.quoteActivityDate).toBe("2025-01-15");
      expect(readAssetCount(db)).toBe(0);

      const result = (await service.importActivities?.(checked)) as {
        activities: Array<Record<string, unknown>>;
        importRunId: string;
        summary: Record<string, unknown>;
      };

      const assetId = result.activities[0]?.assetId as string;
      expect(assetId).toBe(checkedAssetId);
      expect(result.summary).toMatchObject({
        total: 1,
        imported: 1,
        skipped: 0,
        duplicates: 0,
        assetsCreated: 1,
        success: true,
      });
      expect(readAssetById(db, assetId)).toMatchObject({
        display_code: "NVDA",
        instrument_symbol: "NVDA",
        instrument_exchange_mic: "XNAS",
        instrument_type: "EQUITY",
        quote_mode: "MANUAL",
        quote_ccy: "USD",
      });
      expect(readQuoteByAssetDay(db, assetId, "2025-01-15", "MANUAL")).toMatchObject({
        close: "100",
        currency: "USD",
        timestamp: "2025-01-15T12:00:00.000Z",
      });
      expect(readImportRunSummary(db, result.importRunId)).toMatchObject({
        inserted: 1,
        assetsCreated: 1,
      });
      expect(events).toEqual([
        assetsCreatedEvent([assetId]),
        activitiesChangedEvent({
          accountIds: ["account-1"],
          assetIds: [assetId],
          currencies: ["USD"],
          earliest: "2025-01-15T00:00:00.000Z",
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("imports space-padded quote mode as market like Rust", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "BUY",
          date: "2025-01-15",
          symbol: "MSFT",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          quoteMode: " MANUAL ",
          quantity: "1",
          unitPrice: "100",
          amount: "100",
          currency: "USD",
          lineNumber: 1,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      const assetId = result.activities[0]?.assetId as string;
      expect(result.summary).toMatchObject({ success: true, assetsCreated: 1 });
      expect(readAssetById(db, assetId)).toMatchObject({
        display_code: "MSFT",
        quote_mode: "MARKET",
      });
      expect(readQuoteByAssetDay(db, assetId, "2025-01-15", "MANUAL")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("auto-links imported transfer pairs across accounts", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAccount(db, { id: "account-2", name: "Beta", currency: "USD" });

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "TRANSFER_OUT",
          date: "2025-01-15",
          amount: "25",
          currency: "USD",
          isDraft: false,
          isExternal: true,
          lineNumber: 1,
        },
        {
          accountId: "account-2",
          activityType: "TRANSFER_IN",
          date: "2025-01-15",
          amount: "25",
          currency: "USD",
          isDraft: false,
          isExternal: true,
          lineNumber: 2,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({ imported: 2, success: true });
      const outId = result.activities[0]?.id as string;
      const inId = result.activities[1]?.id as string;
      const sourceGroupId = readActivityValue(db, outId, "source_group_id");
      expect(sourceGroupId).toBeString();
      expect(readActivityValue(db, inId, "source_group_id")).toBe(sourceGroupId);
      expect(result.activities[0]).toMatchObject({ sourceGroupId });
      expect(result.activities[1]).toMatchObject({ sourceGroupId });
      expect(readActivityMetadata(db, outId)).toEqual({ flow: { is_external: false } });
      expect(readActivityMetadata(db, inId)).toEqual({ flow: { is_external: false } });
    } finally {
      db.close();
    }
  });

  test("ensures import FX pairs before writing activities", async () => {
    const db = createActivitiesDb();
    const ensuredPairs: Array<[string, string]> = [];
    const service = createActivityService(db, {
      ensureFxPairs: (pairs) => {
        ensuredPairs.push(...pairs);
        throw new Error("fx unavailable");
      },
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "CAD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "EUR",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      await expect(
        service.importActivities?.([
          {
            accountId: "account-1",
            assetId: "AAPL",
            activityType: "BUY",
            date: "2025-01-15",
            quantity: "1",
            unitPrice: "10",
            amount: "10",
            currency: "USD",
            isDraft: false,
            lineNumber: 1,
          },
        ]),
      ).rejects.toThrow("fx unavailable");

      expect(ensuredPairs).toEqual([
        ["USD", "CAD"],
        ["EUR", "CAD"],
      ]);
      expect(readActivityCount(db)).toBe(0);
      expect(readImportRunCount(db)).toBe(0);
    } finally {
      db.close();
    }
  });

  test("skips import duplicates unless force importing", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      const existing = service.createActivity?.({
        accountId: "account-1",
        activityType: "DEPOSIT",
        activityDate: "2025-01-15",
        amount: "10",
        currency: "USD",
      }) as Activity;

      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-15",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-15",
          amount: "10",
          currency: "USD",
          isDraft: false,
          forceImport: true,
          lineNumber: 2,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-16",
          amount: "12",
          currency: "USD",
          isDraft: false,
          forceImport: true,
          lineNumber: 3,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        summary: Record<string, unknown>;
      };

      expect(result.summary).toMatchObject({
        total: 3,
        imported: 2,
        skipped: 1,
        duplicates: 1,
        success: true,
      });
      expect(result.activities[0]).toMatchObject({
        duplicateOfId: existing.id,
        warnings: { _duplicate: ["Duplicate activity already exists"] },
      });
      const forcedDuplicateId = result.activities[1]?.id as string;
      const forcedUniqueId = result.activities[2]?.id as string;
      expect(readActivityValue(db, forcedDuplicateId, "idempotency_key")).toBeNull();
      expect(readActivityValue(db, forcedUniqueId, "idempotency_key")).toBeString();
      expect(readActivityCount(db)).toBe(3);

      const allDuplicateResult = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-15",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
      ])) as {
        importRunId: string;
        summary: Record<string, unknown>;
      };
      expect(allDuplicateResult.importRunId).toBeString();
      expect(allDuplicateResult.importRunId).not.toBe("");
      expect(allDuplicateResult.summary).toMatchObject({
        imported: 0,
        skipped: 1,
        duplicates: 1,
        success: true,
      });
      expect(readActivityCount(db)).toBe(3);
    } finally {
      db.close();
    }
  });

  test("rejects invalid import apply rows without writing activities or import runs", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      const result = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "not-a-date",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-01-16",
          amount: "25",
          currency: "USD",
          isDraft: false,
          lineNumber: 2,
        },
      ])) as {
        activities: Array<Record<string, unknown>>;
        importRunId: string;
        summary: Record<string, unknown>;
      };

      expect(result.importRunId).toBe("");
      expect(result.summary).toMatchObject({
        total: 2,
        imported: 0,
        skipped: 1,
        duplicates: 0,
        success: false,
        errorMessage: "Validation errors found in activities.",
      });
      expect(result.activities[0]).toMatchObject({
        isValid: false,
        errors: { symbol: ["Invalid date 'not-a-date'."] },
      });
      expect(result.activities[1]).toMatchObject({ isValid: true });
      expect(readActivityCount(db)).toBe(0);
      expect(readImportRunCount(db)).toBe(0);
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
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
      insertAsset(db, {
        id: "LSE",
        displayCode: "LSE",
        name: "London",
        quoteCcy: "GBP",
      });
      insertAsset(db, {
        id: "VOD-US",
        displayCode: "VOD",
        name: "Vodafone ADR",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
      insertAsset(db, {
        id: "VOD-LN",
        displayCode: "VOD",
        name: "Vodafone London",
        quoteCcy: "GBP",
        exchangeMic: "XLON",
        instrumentType: "EQUITY",
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

      const existingSymbol = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "aapl", exchangeMic: "XNAS", instrumentType: "EQUITY" },
        activityType: "BUY",
        activityDate: "2025-01-17",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;

      expect(existingSymbol).toMatchObject({
        assetId: "AAPL",
        activityType: "BUY",
      });

      const hintedSymbol = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "vod", exchangeMic: "XLON", instrumentType: "EQUITY", quoteCcy: "GBP" },
        activityType: "BUY",
        activityDate: "2025-01-18",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "GBP",
      }) as Activity;

      expect(hintedSymbol).toMatchObject({
        assetId: "VOD-LN",
        activityType: "BUY",
      });
    } finally {
      db.close();
    }
  });

  test("infers direct activity-created crypto assets from pair symbols like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "btc-usd" },
        activityType: "BUY",
        activityDate: "2025-01-18",
        quantity: "0.5",
        unitPrice: "100000",
        amount: "50000",
        currency: "USD",
      }) as Activity;

      const asset = readAssetById(db, created.assetId ?? "");
      expect(asset).toMatchObject({
        kind: "INVESTMENT",
        display_code: "BTC",
        quote_mode: "MARKET",
        quote_ccy: "USD",
        instrument_type: "CRYPTO",
        instrument_symbol: "BTC",
        instrument_exchange_mic: null,
        provider_config: '{"preferred_provider":"YAHOO"}',
      });

      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          asset: { symbol: "acme-foo" },
          activityType: "BUY",
          activityDate: "2025-01-19",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
        }),
      ).toThrow("Quote currency is required. Please re-select the symbol.");

      const explicitCrypto = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "acme-foo", kind: "CRYPTO" },
        activityType: "BUY",
        activityDate: "2025-01-20",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(readAssetById(db, explicitCrypto.assetId ?? "")).toMatchObject({
        display_code: "ACME",
        quote_ccy: "FOO",
        instrument_type: "CRYPTO",
        instrument_symbol: "ACME",
        instrument_exchange_mic: null,
      });
    } finally {
      db.close();
    }
  });

  test("derives direct activity-created asset kind from trimmed instrument type like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const equityActivity = service.createActivity?.({
        accountId: "account-1",
        asset: {
          symbol: "AAPL",
          kind: "PROPERTY",
          instrumentType: "EQUITY",
          exchangeMic: "XNAS",
          quoteCcy: "USD",
        },
        activityType: "BUY",
        activityDate: "2025-01-21",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(readAssetById(db, equityActivity.assetId ?? "")).toMatchObject({
        kind: "INVESTMENT",
        instrument_type: "EQUITY",
      });

      const fxActivity = service.createActivity?.({
        accountId: "account-1",
        asset: {
          symbol: "EUR/USD",
          kind: "PROPERTY",
          instrumentType: " FX ",
        },
        activityType: "BUY",
        activityDate: "2025-01-22",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(readAssetById(db, fxActivity.assetId ?? "")).toMatchObject({
        kind: "FX",
        instrument_type: "FX",
      });
    } finally {
      db.close();
    }
  });

  test("does not trim direct activity-created quote mode hints like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const activity = service.createActivity?.({
        accountId: "account-1",
        asset: {
          symbol: "BTC-USD",
          quoteMode: " manual ",
        },
        activityType: "BUY",
        activityDate: "2025-01-23",
        quantity: "0.1",
        unitPrice: "100000",
        amount: "10000",
        currency: "USD",
      }) as Activity;

      expect(readAssetById(db, activity.assetId ?? "")).toMatchObject({
        quote_mode: "MARKET",
        instrument_type: "CRYPTO",
      });
      expect(readQuoteByAssetDay(db, activity.assetId ?? "", "2025-01-23", "MANUAL")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("infers Börse Frankfurt provider config for activity-created German ISIN equities", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "EUR" });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: {
          symbol: "de000basf111",
          exchangeMic: "xetr",
          instrumentType: "EQUITY",
          quoteCcy: "EUR",
        },
        activityType: "BUY",
        activityDate: "2025-01-18",
        quantity: "1",
        unitPrice: "50",
        amount: "50",
        currency: "EUR",
      }) as Activity;

      expect(readAssetById(db, created.assetId ?? "")).toMatchObject({
        display_code: "DE000BASF111",
        quote_mode: "MARKET",
        quote_ccy: "EUR",
        instrument_type: "EQUITY",
        instrument_symbol: "DE000BASF111",
        instrument_exchange_mic: "XETR",
        provider_config: '{"preferred_provider":"BOERSE_FRANKFURT"}',
      });
    } finally {
      db.close();
    }
  });

  test("parses Yahoo exchange suffixes for activity-created market assets like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XETR", "EUR"]]),
        yahooSuffixToMic: new Map([["DE", "XETR"]]),
      },
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: {
          symbol: "de000basf111.de",
          instrumentType: "EQUITY",
        },
        activityType: "BUY",
        activityDate: "2025-01-18",
        quantity: "1",
        unitPrice: "50",
        amount: "50",
        currency: "EUR",
      }) as Activity;

      expect(readAssetById(db, created.assetId ?? "")).toMatchObject({
        display_code: "DE000BASF111",
        quote_mode: "MARKET",
        quote_ccy: "EUR",
        instrument_type: "EQUITY",
        instrument_symbol: "DE000BASF111",
        instrument_exchange_mic: "XETR",
        provider_config: '{"preferred_provider":"BOERSE_FRANKFURT"}',
      });
    } finally {
      db.close();
    }
  });

  test("matches existing assets after Yahoo suffix canonicalization like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db, {
      exchangeMetadata: {
        currencyByMic: new Map([["XETR", "EUR"]]),
        yahooSuffixToMic: new Map([["DE", "XETR"]]),
      },
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "BASF-XETR",
        displayCode: "DE000BASF111",
        name: "BASF",
        quoteCcy: "EUR",
        instrumentSymbol: "DE000BASF111",
        exchangeMic: "XETR",
        instrumentType: "EQUITY",
      });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "de000basf111.de" },
        activityType: "BUY",
        activityDate: "2025-01-18",
        quantity: "1",
        unitPrice: "50",
        amount: "50",
        currency: "EUR",
      }) as Activity;

      expect(created.assetId).toBe("BASF-XETR");
      expect(readAssetCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  test("stores structured metadata for direct activity-created option and bond assets like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const optionActivity = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "aapl  240119c00195000", quoteCcy: "USD" },
        activityType: "BUY",
        activityDate: "2025-01-19",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
        metadata: { contract_multiplier: 10 },
      }) as Activity;
      const optionAsset = readAssetById(db, optionActivity.assetId ?? "");

      expect(optionAsset).toMatchObject({
        display_code: "AAPL240119C00195000",
        quote_ccy: "USD",
        instrument_type: "OPTION",
        instrument_symbol: "AAPL240119C00195000",
        instrument_exchange_mic: null,
        provider_config: '{"preferred_provider":"YAHOO"}',
      });
      expect(JSON.parse(optionAsset?.metadata as string)).toEqual({
        option: {
          underlyingAssetId: "AAPL",
          expiration: "2024-01-19",
          right: "CALL",
          strike: 195,
          multiplier: 10,
          occSymbol: "AAPL240119C00195000",
        },
      });

      const bondActivity = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "912797NQ6", kind: "BOND", quoteCcy: "USD" },
        activityType: "BUY",
        activityDate: "2025-01-20",
        quantity: "1",
        unitPrice: "99",
        amount: "99",
        currency: "USD",
      }) as Activity;
      const bondAsset = readAssetById(db, bondActivity.assetId ?? "");

      expect(bondAsset).toMatchObject({
        display_code: "US912797NQ65",
        quote_ccy: "USD",
        instrument_type: "BOND",
        instrument_symbol: "US912797NQ65",
        instrument_exchange_mic: null,
        provider_config: null,
      });
      expect(JSON.parse(bondAsset?.metadata as string)).toEqual({
        bond: {
          maturityDate: null,
          couponRate: 0,
          faceValue: null,
          couponFrequency: "ZERO",
          isin: "US912797NQ65",
        },
      });
    } finally {
      db.close();
    }
  });

  test("normalizes direct activity-created broker option symbols like Rust", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const fidelityOptionActivity = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "-mu270115c600", kind: "OPTION", quoteCcy: "USD" },
        activityType: "BUY",
        activityDate: "2025-01-19",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      const fidelityOptionAsset = readAssetById(db, fidelityOptionActivity.assetId ?? "");

      expect(fidelityOptionAsset).toMatchObject({
        display_code: "MU270115C00600000",
        instrument_type: "OPTION",
        instrument_symbol: "MU270115C00600000",
        instrument_exchange_mic: null,
      });
      expect(JSON.parse(fidelityOptionAsset?.metadata as string)).toEqual({
        option: {
          underlyingAssetId: "MU",
          expiration: "2027-01-15",
          right: "CALL",
          strike: 600,
          multiplier: 100,
          occSymbol: "MU270115C00600000",
        },
      });

      const paddedOptionActivity = service.createActivity?.({
        accountId: "account-1",
        asset: { symbol: "nvda  250117p00850000", quoteCcy: "USD" },
        activityType: "BUY",
        activityDate: "2025-01-20",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      const paddedOptionAsset = readAssetById(db, paddedOptionActivity.assetId ?? "");

      expect(paddedOptionAsset).toMatchObject({
        display_code: "NVDA250117P00850000",
        instrument_type: "OPTION",
        instrument_symbol: "NVDA250117P00850000",
        instrument_exchange_mic: null,
      });
      expect(JSON.parse(paddedOptionAsset?.metadata as string)).toEqual({
        option: {
          underlyingAssetId: "NVDA",
          expiration: "2025-01-17",
          right: "PUT",
          strike: 850,
          multiplier: 100,
          occSymbol: "NVDA250117P00850000",
        },
      });
    } finally {
      db.close();
    }
  });

  test("ensures direct activity FX pairs before create writes", async () => {
    const db = createActivitiesDb();
    const ensuredPairs: Array<[string, string]> = [];
    const service = createActivityService(db, {
      ensureFxPairs: (pairs) => {
        ensuredPairs.push(...pairs);
        throw new Error("fx unavailable");
      },
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "CAD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "EUR",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });

      await expect(
        service.createActivity?.({
          accountId: "account-1",
          asset: { id: "AAPL" },
          activityType: "BUY",
          activityDate: "2025-01-15",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
        }),
      ).rejects.toThrow("fx unavailable");

      expect(ensuredPairs).toEqual([
        ["USD", "CAD"],
        ["EUR", "CAD"],
      ]);
      expect(readActivityCount(db)).toBe(0);
      expect(readAssetCount(db)).toBe(1);
    } finally {
      db.close();
    }
  });

  test("ensures direct activity FX pairs before update writes", async () => {
    const db = createActivitiesDb();

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "CAD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "EUR",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
      const setupService = createActivityService(db);
      const existing = setupService.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "CAD",
      }) as Activity;

      const ensuredPairs: Array<[string, string]> = [];
      const service = createActivityService(db, {
        ensureFxPairs: (pairs) => {
          ensuredPairs.push(...pairs);
          throw new Error("fx unavailable");
        },
      });

      await expect(
        service.updateActivity?.({
          id: existing.id,
          accountId: "account-1",
          asset: { id: "AAPL" },
          activityType: "BUY",
          activityDate: "2025-01-15",
          quantity: "1",
          unitPrice: "11",
          amount: "11",
          currency: "USD",
        }),
      ).rejects.toThrow("fx unavailable");

      expect(ensuredPairs).toEqual([
        ["USD", "CAD"],
        ["EUR", "CAD"],
      ]);
      expect(readActivityValue(db, existing.id, "currency")).toBe("CAD");
    } finally {
      db.close();
    }
  });

  test("writes manual fallback quotes for price-bearing activity writes", () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteMode: "MARKET",
        quoteCcy: "USD",
      });
      insertAsset(db, {
        id: "MSFT",
        displayCode: "MSFT",
        name: "Microsoft",
        quoteMode: "MARKET",
        quoteCcy: "USD",
      });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL", quoteMode: "MANUAL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "10.50",
        amount: "10.50",
        currency: "USD",
      }) as Activity;
      expect(readAssetById(db, "AAPL")).toMatchObject({ quote_mode: "MANUAL" });
      expect(readQuoteByAssetDay(db, "AAPL", "2025-01-15", "MANUAL")).toMatchObject({
        id: "AAPL_2025-01-15_MANUAL",
        open: "10.5",
        high: "10.5",
        low: "10.5",
        close: "10.5",
        adjclose: "10.5",
        volume: null,
        currency: "USD",
        timestamp: "2025-01-15T12:00:00.000Z",
      });

      service.updateActivity?.({
        id: created.id,
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        unitPrice: "12.25",
        currency: "USD",
      });
      expect(readQuoteByAssetDay(db, "AAPL", "2025-01-15", "MANUAL")).toMatchObject({
        close: "12.25",
        timestamp: "2025-01-15T12:00:00.000Z",
      });

      service.createActivity?.({
        accountId: "account-1",
        asset: { id: "MSFT" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "20",
        amount: "20",
        currency: "USD",
      });
      expect(readQuoteByAssetDay(db, "MSFT", "2025-01-15", "MANUAL")).toBeNull();

      service.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "DIVIDEND",
        activityDate: "2025-01-16",
        quantity: "1",
        unitPrice: "2",
        amount: "2",
        currency: "USD",
      });
      expect(readQuoteByAssetDay(db, "AAPL", "2025-01-16", "MANUAL")).toBeNull();
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
          asset: { symbol: "UNKNOWN" },
          activityType: "BUY",
          activityDate: "2025-01-15",
          currency: "USD",
        }),
      ).toThrow("Quote currency is required. Please re-select the symbol.");
      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          asset: {
            symbol: "$FOO",
            exchangeMic: "XNAS",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
          },
          activityType: "BUY",
          activityDate: "2025-01-15",
          currency: "USD",
        }),
      ).toThrow("Invalid symbol '$FOO'. Please search for a valid ticker.");
      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          asset: {
            symbol: "----",
            exchangeMic: "XNAS",
            instrumentType: "EQUITY",
            quoteCcy: "USD",
          },
          activityType: "BUY",
          activityDate: "2025-01-15",
          currency: "USD",
        }),
      ).toThrow("Invalid symbol '----'. Please search for a valid ticker.");
      insertAsset(db, { id: "dup-1", displayCode: "DUP", name: "Duplicate One" });
      insertAsset(db, { id: "dup-2", displayCode: "DUP", name: "Duplicate Two" });
      expect(() =>
        service.createActivity?.({
          accountId: "account-1",
          asset: { symbol: "DUP" },
          activityType: "BUY",
          activityDate: "2025-01-15",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
        }),
      ).toThrow("Multiple existing assets match symbol DUP");
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
      expect(
        db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM activities").get()?.count,
      ).toBe(0);
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
      insertAsset(db, {
        id: "MSFT",
        displayCode: "MSFT",
        name: "Microsoft",
        quoteCcy: "USD",
        instrumentSymbol: "MSFT",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
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
        asset: { symbol: "msft", exchangeMic: "XNAS", instrumentType: "EQUITY" },
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

  test("ensures bulk activity FX pairs before writes", async () => {
    const db = createActivitiesDb();

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "CAD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteCcy: "EUR",
        instrumentSymbol: "AAPL",
        exchangeMic: "XNAS",
        instrumentType: "EQUITY",
      });
      const setupService = createActivityService(db);
      const existing = setupService.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "CAD",
      }) as Activity;

      const ensuredPairs: Array<[string, string]> = [];
      const service = createActivityService(db, {
        ensureFxPairs: (pairs) => {
          ensuredPairs.push(...pairs);
          throw new Error("fx unavailable");
        },
      });

      await expect(
        service.bulkMutateActivities?.({
          creates: [
            {
              id: "temp-create",
              accountId: "account-1",
              asset: { id: "AAPL" },
              activityType: "BUY",
              activityDate: "2025-01-16",
              quantity: "1",
              unitPrice: "12",
              amount: "12",
              currency: "USD",
            },
          ],
          updates: [
            {
              id: existing.id,
              accountId: "account-1",
              asset: { id: "AAPL" },
              activityType: "BUY",
              activityDate: "2025-01-15",
              quantity: "1",
              unitPrice: "11",
              amount: "11",
              currency: "USD",
            },
          ],
        }),
      ).rejects.toThrow("fx unavailable");

      expect(ensuredPairs).toEqual([
        ["USD", "CAD"],
        ["EUR", "CAD"],
      ]);
      expect(readActivityCount(db)).toBe(1);
      expect(readActivityValue(db, existing.id, "currency")).toBe("CAD");
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

  test("emits activities_changed events after successful activity mutations", async () => {
    const db = createActivitiesDb();
    const events: BackendEvent[] = [];
    const service = createActivityService(db, { eventBus: recordingEventBus(events) });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAccount(db, { id: "account-2", name: "Beta", currency: "CAD" });
      insertAsset(db, { id: "AAPL", displayCode: "AAPL", name: "Apple", quoteCcy: "USD" });
      insertAsset(db, { id: "MSFT", displayCode: "MSFT", name: "Microsoft", quoteCcy: "CAD" });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15T10:00:00-05:00",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-1"],
          assetIds: ["AAPL"],
          currencies: ["USD"],
          earliest: "2025-01-15T15:00:00.000Z",
        }),
      ]);

      events.length = 0;
      const createdWithSymbol = service.createActivity?.({
        accountId: "account-1",
        asset: {
          symbol: "UNKNOWN",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          name: "Unknown Corp",
        },
        activityType: "BUY",
        activityDate: "2025-01-16",
        quantity: "2",
        unitPrice: "5",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(createdWithSymbol.assetId).toBeString();
      expect(readAssetById(db, createdWithSymbol.assetId ?? "")).toMatchObject({
        name: "Unknown Corp",
        display_code: "UNKNOWN",
        instrument_symbol: "UNKNOWN",
        instrument_exchange_mic: "XNAS",
        instrument_type: "EQUITY",
        quote_ccy: "USD",
      });
      expect(events).toEqual([
        assetsCreatedEvent([createdWithSymbol.assetId ?? ""]),
        activitiesChangedEvent({
          accountIds: ["account-1"],
          assetIds: [createdWithSymbol.assetId ?? ""],
          currencies: ["USD"],
          earliest: "2025-01-16T00:00:00.000Z",
        }),
      ]);
      events.length = 0;

      const updated = service.updateActivity?.({
        id: created.id,
        accountId: "account-2",
        asset: { id: "MSFT" },
        activityType: "BUY",
        activityDate: "2025-01-14",
        quantity: "1",
        unitPrice: "12",
        amount: "12",
        currency: "CAD",
      }) as Activity;
      expect(updated.accountId).toBe("account-2");
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-1", "account-2"],
          assetIds: ["AAPL", "MSFT"],
          currencies: ["CAD", "USD"],
          earliest: "2025-01-14T00:00:00.000Z",
        }),
      ]);

      events.length = 0;
      expect(service.deleteActivity?.(created.id)).toMatchObject({ id: created.id });
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-2"],
          assetIds: ["MSFT"],
          currencies: ["CAD"],
          earliest: "2025-01-14T00:00:00.000Z",
        }),
      ]);

      insertActivity(db, {
        id: "transfer-in",
        accountId: "account-1",
        activityType: "TRANSFER_IN",
        activityDate: "2025-01-11T00:00:00Z",
      });
      insertActivity(db, {
        id: "transfer-out",
        accountId: "account-2",
        activityType: "TRANSFER_OUT",
        activityDate: "2025-01-10T00:00:00Z",
      });
      events.length = 0;
      service.linkTransferActivities?.("transfer-in", "transfer-out");
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-1", "account-2"],
          assetIds: [],
          currencies: ["USD"],
          earliest: "2025-01-10T00:00:00.000Z",
        }),
      ]);
      events.length = 0;
      service.unlinkTransferActivities?.("transfer-in", "transfer-out");
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-1", "account-2"],
          assetIds: [],
          currencies: ["USD"],
          earliest: "2025-01-10T00:00:00.000Z",
        }),
      ]);

      insertActivity(db, {
        id: "bulk-update",
        accountId: "account-1",
        assetId: "AAPL",
        activityType: "BUY",
        activityDate: "2024-01-01T00:00:00Z",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "EUR",
      });
      insertActivity(db, {
        id: "bulk-delete",
        accountId: "account-2",
        assetId: "MSFT",
        activityType: "BUY",
        activityDate: "2024-01-02T00:00:00Z",
        quantity: "1",
        unitPrice: "20",
        amount: "20",
        currency: "JPY",
      });
      events.length = 0;
      expect(
        service.bulkMutateActivities?.({
          creates: [
            {
              id: "bulk-create-temp",
              accountId: "account-1",
              activityType: "DEPOSIT",
              activityDate: "2025-02-01",
              amount: "5",
              currency: "USD",
            },
          ],
          updates: [
            {
              id: "bulk-update",
              accountId: "account-2",
              asset: { id: "MSFT" },
              activityType: "BUY",
              activityDate: "2025-02-02",
              quantity: "1",
              unitPrice: "12",
              amount: "12",
              currency: "CAD",
            },
          ],
          deleteIds: ["bulk-delete"],
        }) as ActivityBulkMutationResult,
      ).toMatchObject({ errors: [], created: [expect.any(Object)], updated: [expect.any(Object)] });
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-1", "account-2"],
          assetIds: ["AAPL", "MSFT"],
          currencies: ["CAD", "USD"],
          earliest: "2024-01-02T00:00:00.000Z",
        }),
      ]);

      events.length = 0;
      expect(
        service.bulkMutateActivities?.({
          updates: [
            {
              id: "missing-update",
              accountId: "account-1",
              activityType: "DEPOSIT",
              activityDate: "2025-02-03",
              currency: "USD",
            },
          ],
        }) as ActivityBulkMutationResult,
      ).toMatchObject({ errors: [expect.objectContaining({ id: "missing-update" })] });
      expect(events).toEqual([]);

      const duplicateSource = service.createActivity?.({
        accountId: "account-1",
        activityType: "DEPOSIT",
        activityDate: "2025-03-01",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(duplicateSource.id).toBeString();
      events.length = 0;
      const importResult = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-03-01",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
        {
          accountId: "account-1",
          assetId: "AAPL",
          activityType: "BUY",
          date: "2025-03-02",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          isDraft: false,
          forceImport: true,
          lineNumber: 2,
        },
      ])) as { summary: Record<string, unknown> };
      expect(importResult.summary).toMatchObject({ imported: 1, skipped: 1 });
      expect(events).toEqual([
        activitiesChangedEvent({
          accountIds: ["account-1"],
          assetIds: ["AAPL"],
          currencies: ["USD"],
          earliest: "2025-03-02T00:00:00.000Z",
        }),
      ]);

      events.length = 0;
      const allDuplicateResult = (await service.importActivities?.([
        {
          accountId: "account-1",
          activityType: "DEPOSIT",
          date: "2025-03-01",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
      ])) as { summary: Record<string, unknown> };
      expect(allDuplicateResult.summary).toMatchObject({ imported: 0, skipped: 1 });
      expect(events).toEqual([]);
    } finally {
      db.close();
    }
  });

  test("matches Rust activity sync-outbox filtering rules", () => {
    expect(
      shouldQueueActivitySyncEvent("Create", {
        source_system: " PLAID ",
        is_user_modified: 0,
        import_run_id: null,
        source_record_id: "provider-row",
      }),
    ).toBe(false);
    expect(
      shouldQueueActivitySyncEvent("Update", {
        source_system: "PLAID",
        is_user_modified: 1,
        import_run_id: "broker-run",
        source_record_id: "provider-row",
      }),
    ).toBe(true);
    expect(
      shouldQueueActivitySyncEvent("Create", {
        source_system: " csv ",
        is_user_modified: 0,
        import_run_id: "csv-run",
        source_record_id: "row-1",
      }),
    ).toBe(true);
    expect(
      shouldQueueActivitySyncEvent("Create", {
        source_system: null,
        is_user_modified: 0,
        import_run_id: null,
        source_record_id: "provider-row",
      }),
    ).toBe(false);
    expect(
      shouldQueueActivitySyncEvent("Create", {
        source_system: null,
        is_user_modified: 0,
        import_run_id: null,
        source_record_id: null,
      }),
    ).toBe(true);
    expect(
      shouldQueueActivitySyncEvent("Delete", {
        source_system: "PLAID",
        is_user_modified: 0,
        import_run_id: "broker-run",
        source_record_id: "provider-row",
      }),
    ).toBe(true);
  });

  test("queues activity sync events after successful activity writes", async () => {
    const db = createActivitiesDb();
    const syncEvents: ActivitySyncEvent[] = [];
    const service = createActivityService(db, {
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAccount(db, { id: "account-2", name: "Beta", currency: "CAD" });
      insertAsset(db, { id: "AAPL", displayCode: "AAPL", name: "Apple", quoteCcy: "USD" });
      insertAsset(db, { id: "MSFT", displayCode: "MSFT", name: "Microsoft", quoteCcy: "CAD" });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "activities",
          entityId: created.id,
          operation: "Create",
          payload: expect.objectContaining({
            id: created.id,
            source_system: "MANUAL",
            is_user_modified: 0,
          }),
        }),
      ]);

      syncEvents.length = 0;
      service.updateActivity?.({
        id: created.id,
        accountId: "account-2",
        asset: { id: "MSFT" },
        activityType: "BUY",
        activityDate: "2025-01-16",
        quantity: "1",
        unitPrice: "12",
        amount: "12",
        currency: "CAD",
      });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entityId: created.id,
          operation: "Update",
          payload: expect.objectContaining({
            id: created.id,
            account_id: "account-2",
            asset_id: "MSFT",
            is_user_modified: 1,
          }),
        }),
      ]);

      syncEvents.length = 0;
      service.deleteActivity?.(created.id);
      expect(syncEvents).toEqual([
        {
          entity: "activities",
          entityId: created.id,
          operation: "Delete",
          payload: { id: created.id },
        },
      ]);

      insertActivity(db, {
        id: "broker-in",
        accountId: "account-1",
        activityType: "TRANSFER_IN",
        sourceSystem: "PLAID",
        sourceRecordId: "broker-in-row",
        isUserModified: false,
      });
      insertActivity(db, {
        id: "broker-out",
        accountId: "account-2",
        activityType: "TRANSFER_OUT",
        sourceSystem: "PLAID",
        sourceRecordId: "broker-out-row",
        isUserModified: false,
      });
      syncEvents.length = 0;
      service.linkTransferActivities?.("broker-in", "broker-out");
      expect(syncEvents.map((event) => `${event.operation}:${event.entityId}`)).toEqual([
        "Update:broker-in",
        "Update:broker-out",
      ]);
      expect(
        syncEvents.every(
          (event) => (event.payload as Record<string, unknown>).is_user_modified === 1,
        ),
      ).toBe(true);

      insertActivity(db, {
        id: "bulk-update",
        accountId: "account-1",
        assetId: "AAPL",
        activityType: "BUY",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
      });
      insertActivity(db, {
        id: "bulk-delete",
        accountId: "account-2",
        assetId: "MSFT",
        activityType: "BUY",
        quantity: "1",
        unitPrice: "20",
        amount: "20",
      });
      syncEvents.length = 0;
      const bulk = service.bulkMutateActivities?.({
        creates: [
          {
            id: "bulk-create-temp",
            accountId: "account-1",
            activityType: "DEPOSIT",
            activityDate: "2025-02-01",
            amount: "5",
            currency: "USD",
          },
        ],
        updates: [
          {
            id: "bulk-update",
            accountId: "account-2",
            asset: { id: "MSFT" },
            activityType: "BUY",
            activityDate: "2025-02-02",
            quantity: "1",
            unitPrice: "12",
            amount: "12",
            currency: "CAD",
          },
        ],
        deleteIds: ["bulk-delete"],
      }) as ActivityBulkMutationResult;
      expect(syncEvents.map((event) => `${event.operation}:${event.entityId}`)).toEqual([
        "Delete:bulk-delete",
        "Update:bulk-update",
        `Create:${bulk.created[0]?.id}`,
      ]);

      syncEvents.length = 0;
      expect(
        service.bulkMutateActivities?.({
          updates: [
            {
              id: "missing-update",
              accountId: "account-1",
              activityType: "DEPOSIT",
              activityDate: "2025-02-03",
              currency: "USD",
            },
          ],
        }) as ActivityBulkMutationResult,
      ).toMatchObject({ errors: [expect.objectContaining({ id: "missing-update" })] });
      expect(syncEvents).toEqual([]);

      syncEvents.length = 0;
      const importResult = (await service.importActivities?.([
        {
          accountId: "account-1",
          assetId: "AAPL",
          activityType: "BUY",
          date: "2025-03-02",
          quantity: "1",
          unitPrice: "10",
          amount: "10",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
      ])) as { importRunId: string; summary: Record<string, unknown> };
      expect(importResult.summary).toMatchObject({ imported: 1, skipped: 0 });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "import_runs",
          entityId: importResult.importRunId,
          operation: "Create",
          payload: expect.objectContaining({
            id: importResult.importRunId,
            source_system: "csv",
            run_type: "IMPORT",
            status: "APPLIED",
          }),
        }),
        expect.objectContaining({
          entity: "activities",
          operation: "Create",
          payload: expect.objectContaining({
            source_system: "CSV",
            import_run_id: importResult.importRunId,
          }),
        }),
      ]);
    } finally {
      db.close();
    }
  });

  test("queues asset sync events for activity-created assets after commit", async () => {
    const db = createActivitiesDb();
    const syncEvents: ActivitySyncEvent[] = [];
    const service = createActivityService(db, {
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: {
          id: "NVDA-ASSET",
          symbol: "NVDA",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          name: "Nvidia",
        },
        activityType: "BUY",
        activityDate: "2025-04-01",
        quantity: "1",
        unitPrice: "10",
        amount: "10",
        currency: "USD",
      }) as Activity;
      expect(created.assetId).toBe("NVDA-ASSET");
      expect(syncEvents).toEqual([
        {
          entity: "assets",
          entityId: "NVDA-ASSET",
          operation: "Create",
          payload: expect.objectContaining({
            id: "NVDA-ASSET",
            kind: "INVESTMENT",
            name: "Nvidia",
            display_code: "NVDA",
            metadata: null,
            quote_mode: "MARKET",
            quote_ccy: "USD",
            instrument_type: "EQUITY",
            instrument_symbol: "NVDA",
            instrument_exchange_mic: "XNAS",
            provider_config: '{"preferred_provider":"YAHOO"}',
            created_at: expect.any(String),
            updated_at: expect.any(String),
          }),
        },
        expect.objectContaining({
          entity: "activities",
          entityId: created.id,
          operation: "Create",
        }),
      ]);
      expect(syncEvents[0]?.payload).not.toHaveProperty("instrument_key");

      syncEvents.length = 0;
      const importResult = (await service.importActivities?.([
        {
          accountId: "account-1",
          assetId: "NFLX-ASSET",
          symbol: "NFLX",
          exchangeMic: "XNAS",
          instrumentType: "EQUITY",
          quoteCcy: "USD",
          activityType: "BUY",
          date: "2025-04-02",
          quantity: "1",
          unitPrice: "20",
          amount: "20",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
      ])) as { importRunId: string; summary: Record<string, unknown> };
      expect(importResult.summary).toMatchObject({ imported: 1, assetsCreated: 1 });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "assets",
          entityId: "NFLX-ASSET",
          operation: "Create",
          payload: expect.objectContaining({
            id: "NFLX-ASSET",
            display_code: "NFLX",
            instrument_symbol: "NFLX",
          }),
        }),
        expect.objectContaining({
          entity: "import_runs",
          entityId: importResult.importRunId,
          operation: "Create",
        }),
        expect.objectContaining({
          entity: "activities",
          operation: "Create",
          payload: expect.objectContaining({ import_run_id: importResult.importRunId }),
        }),
      ]);

      syncEvents.length = 0;
      const failedBulk = service.bulkMutateActivities?.({
        creates: [
          {
            id: "failed-create",
            accountId: "missing-account",
            asset: {
              id: "FAIL-ASSET",
              symbol: "FAIL",
              exchangeMic: "XNAS",
              instrumentType: "EQUITY",
              quoteCcy: "USD",
            },
            activityType: "BUY",
            activityDate: "2025-04-03",
            quantity: "1",
            unitPrice: "30",
            amount: "30",
            currency: "USD",
          },
        ],
      }) as ActivityBulkMutationResult;
      expect(failedBulk.errors).toEqual([expect.objectContaining({ id: "failed-create" })]);
      expect(syncEvents).toEqual([]);
      expect(readAssetById(db, "FAIL-ASSET")).toBeNull();
    } finally {
      db.close();
    }
  });

  test("queues asset update sync events for activity quote-mode side effects", async () => {
    const db = createActivitiesDb();
    const syncEvents: ActivitySyncEvent[] = [];
    const service = createActivityService(db, {
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      db.exec(`
        CREATE TABLE quote_sync_state (
          asset_id TEXT PRIMARY KEY NOT NULL,
          updated_at TEXT NOT NULL
        );
      `);
      insertAccount(db, { id: "account-1", name: "Alpha", currency: "USD" });
      insertAsset(db, {
        id: "AAPL",
        displayCode: "AAPL",
        name: "Apple",
        quoteMode: "MARKET",
        quoteCcy: "USD",
      });
      db.query("INSERT INTO quote_sync_state (asset_id, updated_at) VALUES (?, ?)").run(
        "AAPL",
        "2025-01-01T00:00:00Z",
      );

      const created = service.createActivity?.({
        accountId: "account-1",
        asset: { id: "AAPL", quoteMode: "MANUAL" },
        activityType: "BUY",
        activityDate: "2025-01-15",
        quantity: "1",
        unitPrice: "10.50",
        amount: "10.50",
        currency: "USD",
      }) as Activity;

      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "assets",
          entityId: "AAPL",
          operation: "Update",
          payload: expect.objectContaining({
            id: "AAPL",
            quote_mode: "MANUAL",
          }),
        }),
        expect.objectContaining({
          entity: "activities",
          entityId: created.id,
          operation: "Create",
        }),
      ]);
      expect(
        db
          .query<
            { count: number },
            []
          >("SELECT COUNT(*) AS count FROM quote_sync_state WHERE asset_id = 'AAPL'")
          .get()?.count,
      ).toBe(0);

      syncEvents.length = 0;
      insertAsset(db, {
        id: "MSFT",
        displayCode: "MSFT",
        name: "Microsoft",
        quoteMode: "MARKET",
        quoteCcy: "USD",
      });
      db.query("INSERT INTO quote_sync_state (asset_id, updated_at) VALUES (?, ?)").run(
        "MSFT",
        "2025-01-01T00:00:00Z",
      );
      const updated = service.updateActivity?.({
        id: created.id,
        accountId: "account-1",
        asset: { id: "MSFT", quoteMode: "MANUAL" },
        activityType: "BUY",
        activityDate: "2025-01-16",
        quantity: "1",
        unitPrice: "12.25",
        amount: "12.25",
        currency: "USD",
      }) as Activity;

      expect(updated.assetId).toBe("MSFT");
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "assets",
          entityId: "MSFT",
          operation: "Update",
          payload: expect.objectContaining({
            id: "MSFT",
            quote_mode: "MANUAL",
          }),
        }),
        expect.objectContaining({
          entity: "activities",
          entityId: created.id,
          operation: "Update",
        }),
      ]);
      expect(
        db
          .query<
            { count: number },
            []
          >("SELECT COUNT(*) AS count FROM quote_sync_state WHERE asset_id = 'MSFT'")
          .get()?.count,
      ).toBe(0);

      syncEvents.length = 0;
      insertAsset(db, {
        id: "GOOGL",
        displayCode: "GOOGL",
        name: "Alphabet",
        quoteMode: "MARKET",
        quoteCcy: "USD",
      });
      db.query("INSERT INTO quote_sync_state (asset_id, updated_at) VALUES (?, ?)").run(
        "GOOGL",
        "2025-01-01T00:00:00Z",
      );

      const imported = (await service.importActivities?.([
        {
          accountId: "account-1",
          assetId: "GOOGL",
          quoteMode: "MANUAL",
          activityType: "BUY",
          date: "2025-01-17",
          quantity: "1",
          unitPrice: "20",
          amount: "20",
          currency: "USD",
          isDraft: false,
          lineNumber: 1,
        },
      ])) as { importRunId: string; summary: Record<string, unknown> };

      expect(imported.summary).toMatchObject({ imported: 1 });
      expect(syncEvents).toEqual([
        expect.objectContaining({
          entity: "assets",
          entityId: "GOOGL",
          operation: "Update",
          payload: expect.objectContaining({
            id: "GOOGL",
            quote_mode: "MANUAL",
          }),
        }),
        expect.objectContaining({
          entity: "import_runs",
          entityId: imported.importRunId,
          operation: "Create",
        }),
        expect.objectContaining({
          entity: "activities",
          operation: "Create",
        }),
      ]);
      expect(
        db
          .query<
            { count: number },
            []
          >("SELECT COUNT(*) AS count FROM quote_sync_state WHERE asset_id = 'GOOGL'")
          .get()?.count,
      ).toBe(0);
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

  test("queues import template and account-template sync callbacks with Rust-compatible filters", async () => {
    const db = createActivitiesDb();
    const syncEvents: ActivitySyncEvent[] = [];
    const service = createActivityService(db, {
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      await service.saveImportTemplate?.({
        id: "system-template",
        name: "System",
        scope: "SYSTEM",
        kind: "CSV_ACTIVITY",
        fieldMappings: { date: "Date" },
      });
      await service.saveImportTemplate?.({
        id: "custom",
        name: "Custom",
        scope: "USER",
        kind: "CSV_HOLDINGS",
        fieldMappings: { symbol: "Ticker" },
      });
      await service.linkAccountTemplate?.("account-2", "custom", "HOLDINGS");
      await service.saveImportMapping?.({
        accountId: "account-2",
        contextKind: "CSV_HOLDINGS",
        name: "Account Local",
        fieldMappings: { symbol: "Symbol" },
      });
      await service.deleteImportTemplate?.("custom");
      await service.deleteImportTemplate?.("missing-template");

      expect(syncEvents.map((event) => [event.entity, event.operation, event.entityId])).toEqual([
        ["import_templates", "Update", "custom"],
        ["import_account_templates", "Update", expect.any(String)],
        ["import_account_templates", "Update", syncEvents[1]?.entityId],
        ["import_templates", "Delete", "custom"],
        ["import_templates", "Delete", "missing-template"],
      ]);
      expect(syncEvents[0]?.payload).toMatchObject({
        id: "custom",
        name: "Custom",
        scope: "USER",
        kind: "CSV_HOLDINGS",
        source_system: "",
        config_version: 1,
      });
      expect(syncEvents[1]?.payload).toMatchObject({
        account_id: "account-2",
        context_kind: "CSV_HOLDINGS",
        source_system: "",
        template_id: "custom",
      });
      expect(syncEvents[2]?.payload).toMatchObject({
        account_id: "account-2",
        context_kind: "CSV_HOLDINGS",
        source_system: "",
        template_id: "acct_account-2_holdings",
      });
      expect(syncEvents[3]?.payload).toEqual({ id: "custom" });
      expect(syncEvents[4]?.payload).toEqual({ id: "missing-template" });
    } finally {
      db.close();
    }
  });

  test("reads broker sync profiles with Rust-compatible precedence and defaults", async () => {
    const db = createActivitiesDb();
    const service = createActivityService(db);

    try {
      insertBrokerTemplate(db, {
        id: "system_snaptrade",
        name: "SnapTrade System",
        scope: "SYSTEM",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["System Buy"] },
        symbolMappings: { AAPL: "AAPL.US" },
      });
      insertBrokerTemplate(db, {
        id: "broker_snaptrade",
        name: "SnapTrade Broker",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["Broker Buy"] },
        symbolMappings: { MSFT: "MSFT.US" },
      });
      insertBrokerTemplate(db, {
        id: "broker_snaptrade_account-1",
        name: "SnapTrade Account",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: { SELL: ["Account Sell"] },
        symbolMappings: { TSLA: "TSLA.US" },
      });
      upsertBrokerLink(db, "account-1", "broker_snaptrade_account-1", "snaptrade");

      expect(await service.getBrokerSyncProfile?.("account-1", "snaptrade")).toEqual({
        id: "broker_snaptrade_account-1",
        name: "SnapTrade Account",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: { SELL: ["Account Sell"] },
        symbolMappings: { TSLA: "TSLA.US" },
        symbolMappingMeta: {},
      });
      expect(await service.getBrokerSyncProfile?.("account-2", "snaptrade")).toEqual({
        id: "broker_snaptrade",
        name: "SnapTrade Broker",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["Broker Buy"] },
        symbolMappings: { MSFT: "MSFT.US" },
        symbolMappingMeta: {},
      });

      db.query("DELETE FROM import_templates WHERE id = 'broker_snaptrade'").run();
      expect(await service.getBrokerSyncProfile?.("account-2", "snaptrade")).toEqual({
        id: "system_snaptrade",
        name: "SnapTrade System",
        scope: "SYSTEM",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["System Buy"] },
        symbolMappings: { AAPL: "AAPL.US" },
        symbolMappingMeta: {},
      });
      expect(await service.getBrokerSyncProfile?.("account-2", "ibkr")).toEqual({
        id: "",
        name: "",
        scope: "USER",
        sourceSystem: "ibkr",
        activityMappings: {},
        symbolMappings: {},
        symbolMappingMeta: {},
      });
    } finally {
      db.close();
    }
  });

  test("saves broker sync profile rules and queues template/link callbacks", async () => {
    const db = createActivitiesDb();
    const syncEvents: ActivitySyncEvent[] = [];
    const service = createActivityService(db, {
      queueSyncEvent: (event) => syncEvents.push(event),
    });

    try {
      insertBrokerTemplate(db, {
        id: "system_snaptrade",
        name: "SnapTrade System",
        scope: "SYSTEM",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["System Buy"] },
        symbolMappings: { AAPL: "AAPL.US" },
        symbolMappingMeta: { AAPL: { exchangeMic: "XNAS", quoteCcy: "USD" } },
      });

      const accountProfile = await service.saveBrokerSyncProfileRules?.({
        accountId: "account-1",
        sourceSystem: "snaptrade",
        scope: "ACCOUNT",
        activityRulePatches: { SELL: ["Account Sell"] },
        securityRulePatches: { MSFT: "MSFT.US" },
        securityRuleMetaPatches: { MSFT: { exchangeMic: "XNAS", symbolName: "Microsoft" } },
      });
      expect(accountProfile).toEqual({
        id: "broker_snaptrade_account-1",
        name: "snaptrade Profile",
        scope: "USER",
        sourceSystem: "snaptrade",
        activityMappings: { BUY: ["System Buy"], SELL: ["Account Sell"] },
        symbolMappings: { AAPL: "AAPL.US", MSFT: "MSFT.US" },
        symbolMappingMeta: {
          AAPL: { exchangeMic: "XNAS", quoteCcy: "USD" },
          MSFT: { exchangeMic: "XNAS", symbolName: "Microsoft" },
        },
      });
      expect(readBrokerLinkedTemplateId(db, "account-1", "snaptrade")).toBe(
        "broker_snaptrade_account-1",
      );

      const brokerProfile = await service.saveBrokerSyncProfileRules?.({
        accountId: "account-1",
        sourceSystem: "snaptrade",
        scope: "BROKER",
        activityRulePatches: { DIVIDEND: ["Broker Dividend"] },
        securityRulePatches: {},
        securityRuleMetaPatches: {},
      });
      expect(brokerProfile?.activityMappings).toEqual({
        BUY: ["System Buy"],
        DIVIDEND: ["Broker Dividend"],
      });
      expect(brokerProfile?.activityMappings).not.toHaveProperty("SELL");

      expect(syncEvents.map((event) => [event.entity, event.operation, event.entityId])).toEqual([
        ["import_templates", "Update", "broker_snaptrade_account-1"],
        ["import_account_templates", "Update", expect.any(String)],
        ["import_templates", "Update", "broker_snaptrade"],
      ]);
      expect(syncEvents[0]?.payload).toMatchObject({
        id: "broker_snaptrade_account-1",
        scope: "USER",
        kind: "BROKER_ACTIVITY",
        source_system: "snaptrade",
      });
      expect(syncEvents[1]?.payload).toMatchObject({
        account_id: "account-1",
        context_kind: "BROKER_ACTIVITY",
        source_system: "snaptrade",
        template_id: "broker_snaptrade_account-1",
      });
      expect(syncEvents[2]?.payload).toMatchObject({
        id: "broker_snaptrade",
        scope: "USER",
        kind: "BROKER_ACTIVITY",
        source_system: "snaptrade",
      });
      expect(JSON.parse(readTemplateConfig(db, "broker_snaptrade"))).toMatchObject({
        activityMappings: { BUY: ["System Buy"], DIVIDEND: ["Broker Dividend"] },
      });
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

    CREATE TABLE import_runs (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      source_system TEXT NOT NULL,
      run_type TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      finished_at TEXT,
      review_mode TEXT NOT NULL,
      applied_at TEXT,
      checkpoint_in TEXT,
      checkpoint_out TEXT,
      summary TEXT,
      warnings TEXT,
      error TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
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
      kind TEXT NOT NULL DEFAULT 'INVESTMENT',
      name TEXT,
      display_code TEXT,
      notes TEXT,
      metadata TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      instrument_symbol TEXT,
      instrument_exchange_mic TEXT,
      quote_mode TEXT,
      quote_ccy TEXT NOT NULL DEFAULT 'USD',
      instrument_type TEXT,
      provider_config TEXT,
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    );

    CREATE TABLE quotes (
      id TEXT PRIMARY KEY NOT NULL,
      asset_id TEXT NOT NULL,
      day TEXT NOT NULL,
      source TEXT NOT NULL,
      open TEXT,
      high TEXT,
      low TEXT,
      close TEXT NOT NULL,
      adjclose TEXT,
      volume TEXT,
      currency TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      FOREIGN KEY (asset_id) REFERENCES assets (id) ON DELETE CASCADE
    );

    CREATE UNIQUE INDEX uq_quotes_asset_day_source
    ON quotes(asset_id, day, source);

    CREATE UNIQUE INDEX ux_activities_idempotency_key
    ON activities(idempotency_key)
    WHERE idempotency_key IS NOT NULL;
  `);
  return db;
}

function recordingEventBus(events: BackendEvent[]): BackendEventBus {
  return {
    publish(event) {
      events.push(event);
    },
    subscribe() {
      return () => undefined;
    },
  };
}

function activitiesChangedEvent(input: {
  accountIds: string[];
  assetIds: string[];
  currencies: string[];
  earliest: string | null;
}): BackendEvent {
  return {
    name: ACTIVITIES_CHANGED_EVENT,
    payload: {
      type: ACTIVITIES_CHANGED_EVENT,
      account_ids: input.accountIds,
      asset_ids: input.assetIds,
      currencies: input.currencies,
      earliest_activity_at_utc: input.earliest,
    },
  };
}

function assetsCreatedEvent(assetIds: string[]): BackendEvent {
  return {
    name: "assets_created",
    payload: {
      type: "assets_created",
      asset_ids: assetIds,
    },
  };
}

function insertTemplate(
  db: Database,
  template: { id: string; name: string; scope: string; kind: string; sourceSystem?: string },
): void {
  db.query(
    `
      INSERT INTO import_templates (
        id, name, scope, kind, source_system, config_version, config, created_at, updated_at
      )
      VALUES (?, ?, ?, ?, ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
  ).run(
    template.id,
    template.name,
    template.scope,
    template.kind,
    template.sourceSystem ?? "",
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

function insertBrokerTemplate(
  db: Database,
  template: {
    id: string;
    name: string;
    scope: string;
    sourceSystem: string;
    activityMappings?: Record<string, string[]>;
    symbolMappings?: Record<string, string>;
    symbolMappingMeta?: Record<string, Record<string, unknown>>;
  },
): void {
  db.query(
    `
      INSERT INTO import_templates (
        id, name, scope, kind, source_system, config_version, config, created_at, updated_at
      )
      VALUES (?, ?, ?, 'BROKER_ACTIVITY', ?, 1, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `,
  ).run(
    template.id,
    template.name,
    template.scope,
    template.sourceSystem,
    JSON.stringify({
      activityMappings: template.activityMappings ?? {},
      symbolMappings: template.symbolMappings ?? {},
      symbolMappingMeta: template.symbolMappingMeta ?? {},
    }),
  );
}

function upsertBrokerLink(
  db: Database,
  accountId: string,
  templateId: string,
  sourceSystem: string,
): void {
  db.query(
    `
      INSERT INTO import_account_templates (
        id, account_id, context_kind, source_system, template_id, created_at, updated_at
      )
      VALUES (?, ?, 'BROKER_ACTIVITY', ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      ON CONFLICT(account_id, context_kind, source_system) DO UPDATE SET
        template_id = excluded.template_id,
        updated_at = excluded.updated_at
    `,
  ).run(`link_${accountId}_${sourceSystem}`, accountId, sourceSystem, templateId);
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
  notes?: string | null;
  instrumentType?: string | null;
  quoteMode?: string | null;
  quoteCcy?: string;
  exchangeMic?: string | null;
  instrumentSymbol?: string | null;
  metadata?: string | null;
  providerConfig?: string | null;
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
        id, kind, name, display_code, notes, metadata, is_active, instrument_symbol, instrument_exchange_mic,
        quote_mode, quote_ccy, instrument_type, provider_config
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
  ).run(
    asset.id,
    "INVESTMENT",
    asset.name,
    asset.displayCode,
    asset.notes ?? null,
    asset.metadata ?? null,
    1,
    asset.instrumentSymbol ?? asset.displayCode,
    asset.exchangeMic ?? null,
    asset.quoteMode ?? "MARKET",
    asset.quoteCcy ?? "USD",
    asset.instrumentType ?? null,
    asset.providerConfig ?? null,
  );
}

function utf16LeWithBom(text: string): Uint8Array {
  const bytes = [0xff, 0xfe];
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    bytes.push(code & 0xff, code >> 8);
  }
  return new Uint8Array(bytes);
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
  column:
    | "id"
    | "idempotency_key"
    | "import_run_id"
    | "source_group_id"
    | "source_system"
    | "status"
    | "subtype"
    | "currency",
): string | null {
  const row = db
    .query<
      { value: string | null },
      [string]
    >(`SELECT ${column} AS value FROM activities WHERE id = ?`)
    .get(activityId);
  return row?.value ?? null;
}

function readActivityCount(db: Database): number {
  return (
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM activities").get()?.count ?? 0
  );
}

function readAssetCount(db: Database): number {
  return db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM assets").get()?.count ?? 0;
}

function readAssetById(db: Database, assetId: string): Record<string, unknown> | null {
  return db
    .query<Record<string, unknown>, [string]>("SELECT * FROM assets WHERE id = ?")
    .get(assetId);
}

function readQuoteByAssetDay(
  db: Database,
  assetId: string,
  day: string,
  source: string,
): Record<string, unknown> | null {
  return db
    .query<
      Record<string, unknown>,
      [string, string, string]
    >("SELECT * FROM quotes WHERE asset_id = ? AND day = ? AND source = ?")
    .get(assetId, day, source);
}

function readActivityMetadata(db: Database, activityId: string): unknown {
  const row = db
    .query<{ metadata: string | null }, [string]>("SELECT metadata FROM activities WHERE id = ?")
    .get(activityId);
  return row?.metadata ? JSON.parse(row.metadata) : null;
}

function readImportRunCount(db: Database): number {
  return (
    db.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM import_runs").get()?.count ?? 0
  );
}

function readImportRun(db: Database, importRunId: string): Record<string, unknown> | null {
  return db
    .query<Record<string, unknown>, [string]>("SELECT * FROM import_runs WHERE id = ?")
    .get(importRunId);
}

function readImportRunSummary(db: Database, importRunId: string): Record<string, unknown> | null {
  const row = db
    .query<{ summary: string | null }, [string]>("SELECT summary FROM import_runs WHERE id = ?")
    .get(importRunId);
  return row?.summary ? (JSON.parse(row.summary) as Record<string, unknown>) : null;
}

function readLinkId(db: Database, accountId: string, contextKind: string): string | null {
  return readLinkValue(db, accountId, contextKind, "id");
}

function readLinkedTemplateId(db: Database, accountId: string, contextKind: string): string | null {
  return readLinkValue(db, accountId, contextKind, "template_id");
}

function readBrokerLinkedTemplateId(
  db: Database,
  accountId: string,
  sourceSystem: string,
): string | null {
  const row = db
    .query<{ template_id: string }, [string, string]>(
      `
        SELECT template_id
        FROM import_account_templates
        WHERE account_id = ?
          AND context_kind = 'BROKER_ACTIVITY'
          AND source_system = ?
      `,
    )
    .get(accountId, sourceSystem);
  return row?.template_id ?? null;
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
