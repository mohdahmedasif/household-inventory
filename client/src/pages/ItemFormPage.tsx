import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App as AntdApp,
  AutoComplete,
  Button,
  Card,
  Collapse,
  DatePicker,
  Form,
  Grid,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tooltip,
  Typography,
  Upload,
} from "antd";
import {
  ArrowLeftOutlined,
  CameraOutlined,
  ClockCircleOutlined,
  CloseOutlined,
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MergeCellsOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import PageActions, { usePageTitle } from "../layout/PageActions";
import { shrinkPhoto } from "../shrinkPhoto";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { ColumnsType } from "antd/es/table";
import {
  addBatch,
  adjustBatchCount,
  createProduct,
  deleteBatch,
  deleteProduct,
  extractFromImages,
  fetchCatalog,
  fetchCompanies,
  fetchProduct,
  fetchProductEvents,
  fetchProducts,
  fetchSimilarProducts,
  mergeProduct,
  updateBatch,
  updateProduct,
  type Batch,
  type Catalog,
  type Product,
  type ProductCreateInput,
  type ProductSummary,
  type SimilarProduct,
  type StockEvent,
  undoStockEvent,
} from "../api";
import {
  emptyBatchInput,
  emptyProductInput,
  expiryLabel,
  expiryTone,
  sizeLabel,
} from "../format";

type ProductForm = {
  name: string;
  category: string;
  notes: string;
};

type BatchForm = {
  company?: string;
  location?: string;
  package_type?: string;
  package_count?: number;
  units_per_package?: string;
  size_value?: string;
  size_unit?: string;
  notes?: string;
  expiry?: Dayjs | null;
  acquired?: Dayjs | null;
};

type Photo = { id: string; file: File; url: string };

// Matches the server's limit on photos read together.
const maxPhotos = 6;

type NewProductForm = ProductCreateInput & {
  expiry?: Dayjs | null;
};

const EVENT_LABELS: Record<StockEvent["kind"], string> = {
  purchase: "Purchased",
  used: "Used",
  added: "Added back",
  removed: "Purchase deleted",
};

export default function ItemFormPage() {
  const { id } = useParams();
  const isNew = !id || id === "new";
  const productId = !isNew ? Number.parseInt(id, 10) : null;
  const editing = Number.isInteger(productId);
  const navigate = useNavigate();
  const { message } = AntdApp.useApp();
  const [productForm] = Form.useForm<ProductForm>();
  const [newForm] = Form.useForm<NewProductForm>();
  const [batchForm] = Form.useForm<BatchForm>();
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(editing);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [editingBatch, setEditingBatch] = useState<Batch | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);
  const [similar, setSimilar] = useState<SimilarProduct[]>([]);
  const similarTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [mergeTarget, setMergeTarget] = useState<number | undefined>();
  const [mergeOptions, setMergeOptions] = useState<ProductSummary[]>([]);
  const [mergeBusy, setMergeBusy] = useState(false);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const photosRef = useRef<Photo[]>([]);
  const readTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [photoCaption, setPhotoCaption] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [events, setEvents] = useState<StockEvent[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [moreOpen, setMoreOpen] = useState(false);
  const addAnother = useRef(false);
  usePageTitle(editing ? product?.name : undefined);
  // Below tablet width each purchase is a card instead of a table row.
  const isPhone = !Grid.useBreakpoint().md;

  function updatePhotos(next: Photo[]) {
    photosRef.current = next;
    setPhotos(next);
  }

  useEffect(
    () => () => {
      for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
      if (readTimer.current) clearTimeout(readTimer.current);
    },
    [],
  );

  // Photos are scaled down on the device, then read together a moment after
  // the last one is added, so taking several in a row sends one request.
  async function addPhotos(files: File[]) {
    const room = maxPhotos - photosRef.current.length;
    if (room <= 0) {
      message.warning(`Up to ${maxPhotos} photos per product`);
      return;
    }
    const shrunk = await Promise.all(files.slice(0, room).map(shrinkPhoto));
    updatePhotos([
      ...photosRef.current,
      ...shrunk.map((file) => ({ id: `${Date.now()}-${Math.random()}`, file, url: URL.createObjectURL(file) })),
    ]);
    if (readTimer.current) clearTimeout(readTimer.current);
    readTimer.current = setTimeout(() => void onExtractPhoto(), 1200);
  }

  function removePhoto(id: string) {
    const photo = photosRef.current.find((entry) => entry.id === id);
    if (photo) URL.revokeObjectURL(photo.url);
    updatePhotos(photosRef.current.filter((entry) => entry.id !== id));
  }

  function clearPhoto() {
    for (const photo of photosRef.current) URL.revokeObjectURL(photo.url);
    updatePhotos([]);
  }

  async function onExtractPhoto() {
    if (readTimer.current) clearTimeout(readTimer.current);
    const files = photosRef.current.map((photo) => photo.file);
    if (!files.length) {
      message.warning("Add a photo first");
      return;
    }
    setExtracting(true);
    try {
      const { item } = await extractFromImages(files, photoCaption);
      newForm.setFieldsValue({
        ...item,
        expiry: item.expiry_date ? dayjs(item.expiry_date) : null,
      });
      lookupSimilar(item.name ?? "", item.category ?? "");
      setMoreOpen(Boolean(item.units_per_package || item.batch_notes));
      message.success(
        files.length > 1
          ? `Details filled from ${files.length} photos — review and save`
          : "Details filled from photo — review and save",
      );
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not read the photos");
    } finally {
      setExtracting(false);
    }
  }

  function lookupSimilar(name: string, category: string) {
    if (similarTimer.current) clearTimeout(similarTimer.current);
    if (!name.trim()) {
      setSimilar([]);
      return;
    }
    similarTimer.current = setTimeout(() => {
      fetchSimilarProducts(name, category)
        .then(({ products }) => setSimilar(products))
        .catch(() => setSimilar([]));
    }, 350);
  }

  async function openMerge() {
    setMergeTarget(undefined);
    setMergeOpen(true);
    try {
      const { products } = await fetchProducts();
      setMergeOptions(products.filter((p) => p.product_id !== productId));
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Failed to load products");
    }
  }

  async function onMerge() {
    if (!productId || !mergeTarget) return;
    setMergeBusy(true);
    try {
      const merged = await mergeProduct(productId, mergeTarget);
      message.success(`Merged into ${merged.name}`);
      setMergeOpen(false);
      navigate(`/products/${merged.product_id}`, { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Merge failed");
    } finally {
      setMergeBusy(false);
    }
  }

  async function reload(idToLoad: number) {
    const [data, history] = await Promise.all([
      fetchProduct(idToLoad),
      fetchProductEvents(idToLoad).catch(() => ({ events: [] })),
    ]);
    setEvents(history.events);
    setProduct(data);
    productForm.setFieldsValue({
      name: data.name,
      category: data.category,
      notes: data.notes,
    });
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cat = await fetchCatalog();
        if (cancelled) return;
        setCatalog(cat);
        fetchCompanies()
          .then(({ companies: rows }) => setCompanies(rows.map((row) => row.name)))
          .catch(() => setCompanies([]));
        if (editing && productId) {
          await reload(productId);
        } else {
          newForm.setFieldsValue(emptyProductInput());
        }
      } catch (err) {
        message.error(err instanceof Error ? err.message : "Failed to load product");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, productId, message, productForm, newForm]);

  async function onSaveProduct(values: ProductForm) {
    if (!productId) return;
    try {
      const updated = await updateProduct(productId, values);
      setProduct(updated);
      message.success("Product saved");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  function buildNewBody(values: NewProductForm): ProductCreateInput {
    return {
      ...emptyProductInput(),
      ...values,
      expiry_date: values.expiry ? values.expiry.format("YYYY-MM-DD") : "",
      package_count: Number(values.package_count) || 0,
      company: values.company || values.brand || "",
    };
  }

  // "Save & add another" keeps the form open for the next item.
  function resetForNext() {
    clearPhoto();
    setPhotoCaption("");
    setSimilar([]);
    setMoreOpen(false);
    newForm.resetFields();
    newForm.setFieldsValue(emptyProductInput());
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function onCreate(values: NewProductForm) {
    const stay = addAnother.current;
    addAnother.current = false;
    try {
      const created = await createProduct(buildNewBody(values));
      message.success(`Added ${created.name}`);
      if (stay) {
        resetForNext();
        return;
      }
      navigate(`/products/${created.product_id}`, { replace: true });
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Save failed");
    }
  }

  async function onAddToExisting(target: SimilarProduct) {
    try {
      const values = await newForm.validateFields();
      const {
        name: _name,
        category: _category,
        notes: _productNotes,
        batch_notes: batchNotes,
        ...batch
      } = buildNewBody(values);
      await addBatch(target.product_id, { ...batch, notes: batchNotes ?? "" });
      message.success(`Added as a purchase of ${target.name}`);
      navigate(`/products/${target.product_id}`, { replace: true });
    } catch (err) {
      if (err instanceof Error) message.error(err.message);
    }
  }

  function openAddBatch() {
    setEditingBatch(null);
    // Buying again: start from the latest purchase so only count and expiry need typing.
    const last = [...(product?.batches ?? [])].sort(
      (a, b) => b.acquired_on.localeCompare(a.acquired_on) || b.batch_id - a.batch_id,
    )[0];
    batchForm.setFieldsValue({
      ...emptyBatchInput(),
      company: last?.company ?? "",
      location: last?.location || emptyBatchInput().location,
      package_type: last?.package_type || emptyBatchInput().package_type,
      units_per_package: last?.units_per_package ?? "",
      size_value: last?.size_value ?? "",
      size_unit: last?.size_unit ?? "",
      package_count: 1,
      notes: "",
      expiry: null,
      acquired: dayjs(),
    });
    setMoreOpen(false);
    setBatchModalOpen(true);
  }

  // Copy a purchase row into a new purchase, dated today, ready to adjust and save.
  function openCopyBatch(batch: Batch) {
    setEditingBatch(null);
    batchForm.setFieldsValue({
      company: batch.company,
      location: batch.location,
      package_type: batch.package_type,
      package_count: batch.package_count || 1,
      units_per_package: batch.units_per_package,
      size_value: batch.size_value,
      size_unit: batch.size_unit,
      notes: batch.notes,
      expiry: batch.expiry_date ? dayjs(batch.expiry_date) : null,
      acquired: dayjs(),
    });
    setMoreOpen(Boolean(batch.units_per_package || batch.notes));
    setBatchModalOpen(true);
  }

  function openEditBatch(batch: Batch) {
    setEditingBatch(batch);
    batchForm.setFieldsValue({
      company: batch.company,
      location: batch.location,
      package_type: batch.package_type,
      package_count: batch.package_count,
      units_per_package: batch.units_per_package,
      size_value: batch.size_value,
      size_unit: batch.size_unit,
      notes: batch.notes,
      expiry: batch.expiry_date ? dayjs(batch.expiry_date) : null,
      acquired: batch.acquired_on ? dayjs(batch.acquired_on) : null,
    });
    setMoreOpen(Boolean(batch.units_per_package || batch.notes));
    setBatchModalOpen(true);
  }

  async function onSaveBatch(values: BatchForm) {
    if (!productId) return;
    setBatchBusy(true);
    const body = {
      company: values.company || "",
      location: values.location || "",
      package_type: values.package_type || "",
      package_count: Number(values.package_count) || 0,
      units_per_package: values.units_per_package || "",
      size_value: values.size_value || "",
      size_unit: values.size_unit || "",
      notes: values.notes || "",
      expiry_date: values.expiry ? values.expiry.format("YYYY-MM-DD") : "",
      acquired_on: values.acquired ? values.acquired.format("YYYY-MM-DD") : "",
    };
    try {
      if (editingBatch) {
        await updateBatch(editingBatch.batch_id, body);
        message.success("Batch updated");
      } else {
        await addBatch(productId, body);
        message.success("Purchase added");
      }
      setBatchModalOpen(false);
      await reload(productId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Batch save failed");
    } finally {
      setBatchBusy(false);
    }
  }

  async function onCount(batch: Batch, delta: number) {
    if (!productId) return;
    try {
      await adjustBatchCount(batch.batch_id, delta);
      await reload(productId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Count update failed");
    }
  }

  async function onUndoEvent(event: StockEvent) {
    if (!productId) return;
    try {
      await undoStockEvent(event.event_id);
      await reload(productId);
      message.success("Undone");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Undo failed");
    }
  }

  async function onSaveNote(batch: Batch, next: string) {
    if (!productId) return;
    const notes = next.trim();
    if (notes === batch.notes) return;
    try {
      await updateBatch(batch.batch_id, { notes });
      await reload(productId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Note update failed");
    }
  }

  async function onDeleteBatch(batch: Batch) {
    if (!productId) return;
    try {
      const result = await deleteBatch(batch.batch_id);
      message.success("Batch deleted");
      if (result.product_deleted) {
        navigate("/");
        return;
      }
      await reload(productId);
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Delete failed");
    }
  }

  const optionsOf = (values: string[] | undefined) =>
    (values ?? []).map((value) => ({ value, label: value }));
  const companyOptions = companies.map((value) => ({ value }));
  const matchesTyped = (input: string, option?: { value: string }) =>
    String(option?.value ?? "").toLowerCase().includes(input.toLowerCase());

  // Size is one control: the number, with its unit picked from the Units list.
  const sizeField = (large: boolean) => (
    <Space.Compact block>
      <Form.Item name="size_value" noStyle>
        <Input size={large ? "large" : undefined} placeholder="e.g. 500" inputMode="decimal" />
      </Form.Item>
      <Form.Item name="size_unit" noStyle>
        <Select
          size={large ? "large" : undefined}
          allowClear
          placeholder="Unit"
          options={optionsOf(catalog?.size_units)}
          style={{ width: 110, flex: "none" }}
        />
      </Form.Item>
    </Space.Compact>
  );

  const inStock = (product?.batches ?? []).filter((batch) => batch.package_count > 0);
  const usedUp = (product?.batches ?? []).filter((batch) => batch.package_count <= 0);

  const countStepper = (row: Batch) => (
    <span className="batch-stepper">
      <Button
        size="small"
        shape="circle"
        disabled={row.package_count <= 0}
        onClick={() => void onCount(row, -1)}
        aria-label="Use one from this purchase"
      >
        −
      </Button>
      <span>{row.package_count}</span>
      <Button size="small" shape="circle" onClick={() => void onCount(row, 1)} aria-label="Add one to this purchase">
        +
      </Button>
    </span>
  );

  const noteEditor = (row: Batch) => (
    <Typography.Text
      className={row.notes ? "batch-note" : "batch-note empty"}
      editable={{
        tooltip: "Edit note",
        text: row.notes,
        onChange: (next) => void onSaveNote(row, next),
      }}
    >
      {row.notes || "Add note"}
    </Typography.Text>
  );

  const expiryPill = (value: string) => (
    <span className={`expiry-pill ${expiryTone(value)}`} title={value || undefined}>
      <ClockCircleOutlined />
      {expiryLabel(value)}
    </span>
  );

  const batchActions = (row: Batch) => (
    <Space size={2}>
      <Tooltip title="Copy as new purchase">
        <Button type="text" icon={<CopyOutlined />} aria-label="Copy as new purchase" onClick={() => openCopyBatch(row)} />
      </Tooltip>
      <Tooltip title="Edit purchase">
        <Button type="text" icon={<EditOutlined />} aria-label="Edit purchase" onClick={() => openEditBatch(row)} />
      </Tooltip>
      <Popconfirm
        title="Delete this purchase batch?"
        description="If it is the last batch, the product is removed too."
        onConfirm={() => void onDeleteBatch(row)}
      >
        <Button type="text" danger icon={<DeleteOutlined />} aria-label="Delete purchase" />
      </Popconfirm>
    </Space>
  );

  const batchCards = (rows: Batch[], empty?: string) =>
    rows.length ? (
      <div className="batch-cards">
        {rows.map((row) => (
          <div key={row.batch_id} className="batch-card">
            <div className="batch-card-head">
              <div className="batch-card-title">
                <strong>{row.company || "No company"}</strong>
                <span>
                  {[row.package_type, sizeLabel(row), row.location].filter(Boolean).join(" · ")}
                  <span className="batch-id"> · #{row.batch_id}</span>
                </span>
              </div>
              {countStepper(row)}
            </div>
            <div className="batch-card-meta">
              {expiryPill(row.expiry_date)}
              {row.acquired_on ? <span>Bought {row.acquired_on}</span> : null}
            </div>
            <div className="batch-card-foot">
              {noteEditor(row)}
              {batchActions(row)}
            </div>
          </div>
        ))}
      </div>
    ) : empty ? (
      <p className="overview-empty">{empty}</p>
    ) : null;

  const batchColumns: ColumnsType<Batch> = [
    {
      title: "#",
      dataIndex: "batch_id",
      width: 64,
      render: (value: number) => <span className="batch-id">#{value}</span>,
    },
    {
      title: "Company",
      dataIndex: "company",
      render: (value: string) => (value ? <strong>{value}</strong> : "—"),
    },
    { title: "Location", dataIndex: "location", width: 150 },
    {
      title: "Package",
      render: (_: unknown, row) => (
        <span className="batch-package">
          <span>{row.package_type}</span>
          {sizeLabel(row) ? <small>{sizeLabel(row)}</small> : null}
        </span>
      ),
    },
    {
      title: "Count",
      dataIndex: "package_count",
      width: 140,
      render: (_: number, row) => countStepper(row),
    },
    {
      title: "Note",
      dataIndex: "notes",
      width: 190,
      render: (_: string, row) => noteEditor(row),
    },
    {
      title: "Expiry",
      dataIndex: "expiry_date",
      width: 150,
      render: (value: string) => expiryPill(value),
    },
    {
      title: "Acquired",
      dataIndex: "acquired_on",
      width: 120,
      render: (value: string) => value || "—",
    },
    {
      title: "",
      key: "actions",
      width: 132,
      align: "right",
      render: (_: unknown, row) => batchActions(row),
    },
  ];

  if (isNew || !editing) {
    return (
      <div className="add-product-page">
        <PageActions>
          <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}>
            Back
          </Button>
          <Button onClick={() => navigate("/")}>Cancel</Button>
          <Button
            onClick={() => {
              addAnother.current = true;
              newForm.submit();
            }}
          >
            Save & add another
          </Button>
          <Button type="primary" onClick={() => newForm.submit()}>
            Save product
          </Button>
        </PageActions>

        <p className="page-subheading">
          Scan a label or fill the form. Matching name + category becomes another purchase of an existing product.
        </p>

        <Form
          form={newForm}
          layout="vertical"
          className="add-product-form"
          initialValues={emptyProductInput()}
          onFinish={(values) => void onCreate(values)}
          onValuesChange={(changed, all) => {
            if ("name" in changed || "category" in changed) {
              lookupSimilar(all.name ?? "", all.category ?? "");
            }
          }}
        >
          <section className="add-scan surface-card">
            <div className="add-scan-copy">
              <span className="add-scan-kicker">Quick add</span>
              <h2>Scan a label</h2>
              <p>Gemini reads the photo and fills the fields below for review.</p>
            </div>
            <div className="extract-zone">
              <div className="photo-area">
                {photos.length ? (
                  <div className="photo-strip">
                    {photos.map((photo, index) => (
                      <div key={photo.id} className="photo-thumb">
                        <img src={photo.url} alt={`Photo ${index + 1}`} />
                        <button
                          type="button"
                          aria-label={`Remove photo ${index + 1}`}
                          disabled={extracting}
                          onClick={() => removePhoto(photo.id)}
                        >
                          <CloseOutlined />
                        </button>
                      </div>
                    ))}
                    {photos.length < maxPhotos ? (
                      <Upload
                        accept="image/*"
                        multiple
                        showUploadList={false}
                        disabled={extracting}
                        beforeUpload={(file, fileList) => {
                          if (file === fileList[fileList.length - 1]) void addPhotos(fileList);
                          return false;
                        }}
                      >
                        <button type="button" className="photo-add" disabled={extracting}>
                          <PlusOutlined />
                          Add
                        </button>
                      </Upload>
                    ) : null}
                  </div>
                ) : (
                  <Upload.Dragger
                    accept="image/*"
                    multiple
                    showUploadList={false}
                    disabled={extracting}
                    beforeUpload={(file, fileList) => {
                      if (file === fileList[fileList.length - 1]) void addPhotos(fileList);
                      return false;
                    }}
                  >
                    <p className="ant-upload-drag-icon">
                      <CameraOutlined />
                    </p>
                    <p className="ant-upload-text">Choose or drop product photos</p>
                    <p className="ant-upload-hint">
                      Up to {maxPhotos}: front, back, the expiry date. They are read together.
                    </p>
                  </Upload.Dragger>
                )}
              </div>
              <div className="extract-controls">
                <Input.TextArea
                  rows={3}
                  placeholder="Optional note for Gemini — e.g. 2 packs, kitchen cabinet"
                  value={photoCaption}
                  onChange={(e) => setPhotoCaption(e.target.value)}
                  disabled={extracting}
                />
                <div className="extract-actions">
                  <Upload
                    accept="image/*"
                    capture="environment"
                    multiple={false}
                    showUploadList={false}
                    disabled={extracting || photos.length >= maxPhotos}
                    beforeUpload={(file) => {
                      void addPhotos([file]);
                      return false;
                    }}
                  >
                    <Button
                      type="primary"
                      size="large"
                      icon={<CameraOutlined />}
                      loading={extracting}
                      disabled={photos.length >= maxPhotos}
                      block
                    >
                      {extracting ? "Reading…" : photos.length ? "Take another photo" : "Take photo"}
                    </Button>
                  </Upload>
                  {photos.length ? (
                    <Button
                      size="large"
                      icon={<ThunderboltOutlined />}
                      disabled={extracting}
                      onClick={() => void onExtractPhoto()}
                      block
                    >
                      {photos.length > 1 ? `Read ${photos.length} photos` : "Read again"}
                    </Button>
                  ) : null}
                  {photos.length ? (
                    <Button size="large" disabled={extracting} onClick={clearPhoto} block>
                      Clear photos
                    </Button>
                  ) : null}
                </div>
              </div>
            </div>
          </section>

          <Card loading={loading} className="surface-card add-details-card">
            <div className="form-sections">
              <div className="form-section">
                <h3>Product</h3>
                <div className="form-row">
                  <Form.Item
                    name="name"
                    label="Product name"
                    className="form-field-wide"
                    rules={[{ required: true, message: "Name is required" }]}
                  >
                    <Input size="large" placeholder="e.g. Chickpeas" />
                  </Form.Item>
                  <Form.Item name="company" label="Company / brand" className="form-field-wide">
                    <AutoComplete
                      size="large"
                      options={companyOptions}
                      filterOption={matchesTyped}
                      placeholder="Optional"
                      allowClear
                    />
                  </Form.Item>
                </div>
                {similar.some((p) => p.exact) ? (
                  <Alert
                    type="info"
                    showIcon
                    message={`This will be saved as another purchase of ${similar.find((p) => p.exact)?.name}.`}
                  />
                ) : similar.length ? (
                  <Alert
                    type="warning"
                    showIcon
                    message="Looks like something you already have"
                    description={
                      <Space direction="vertical" size={8} style={{ width: "100%" }}>
                        {similar.map((p) => (
                          <div key={p.product_id} className="similar-row">
                            <span>
                              <strong>{p.name}</strong> ({p.category}) · {p.purchase_count}{" "}
                              purchase(s), {p.on_hand} on hand
                              {p.companies.length ? ` · ${p.companies.join(", ")}` : ""}
                            </span>
                            <Button size="small" onClick={() => void onAddToExisting(p)}>
                              Add as purchase
                            </Button>
                          </div>
                        ))}
                        <Typography.Text type="secondary">
                          Or save to create a new product.
                        </Typography.Text>
                      </Space>
                    }
                  />
                ) : null}
                <div className="form-row">
                  <Form.Item name="category" label="Category" className="form-field-wide">
                    <Select
                      size="large"
                      options={(catalog?.categories ?? []).map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item
                    name="notes"
                    label="Product notes"
                    className="form-field-wide"
                    tooltip="Applies to every purchase of this product (e.g. what a medicine treats)."
                  >
                    <Input.TextArea rows={2} placeholder="Optional" />
                  </Form.Item>
                </div>
              </div>

              <div className="form-section">
                <h3>This purchase</h3>
                <div className="form-row">
                  <Form.Item name="location" label="Location" className="form-field-wide">
                    <Select
                      size="large"
                      options={(catalog?.locations ?? []).map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="package_type" label="Package type" className="form-field-wide">
                    <Select
                      size="large"
                      options={(catalog?.package_types ?? []).map((value) => ({
                        value,
                        label: value,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name="package_count" label="Count" className="form-field-narrow">
                    <InputNumber size="large" min={0} style={{ width: "100%" }} />
                  </Form.Item>
                </div>
                <div className="form-row">
                  <Form.Item label="Size" className="form-field-wide">
                    {sizeField(true)}
                  </Form.Item>
                  <Form.Item name="expiry" label="Expiry" className="form-field-wide">
                    <DatePicker size="large" style={{ width: "100%" }} />
                  </Form.Item>
                </div>
                <Collapse
                  ghost
                  className="more-fields"
                  activeKey={moreOpen ? ["more"] : []}
                  onChange={(keys) => setMoreOpen(keys.length > 0)}
                  items={[
                    {
                      key: "more",
                      label: "More details",
                      forceRender: true,
                      children: (
                        <div className="form-row">
                          <Form.Item
                            name="units_per_package"
                            label="Units per pack"
                            className="form-field-narrow"
                            tooltip="Pieces inside one package, e.g. tablets per strip."
                          >
                            <Input size="large" inputMode="numeric" />
                          </Form.Item>
                          <Form.Item
                            name="batch_notes"
                            label="Batch note"
                            className="form-field-wide"
                            tooltip="What makes this batch different, e.g. sliced, baked, chopped."
                          >
                            <Input size="large" placeholder="Optional, e.g. Sliced" allowClear />
                          </Form.Item>
                        </div>
                      ),
                    },
                  ]}
                />
              </div>
            </div>
          </Card>
        </Form>
      </div>
    );
  }

  return (
    <>
      <PageActions>
        <Button icon={<ArrowLeftOutlined />} onClick={() => navigate("/")}>
          Back
        </Button>
        {productId ? (
          <Button icon={<MergeCellsOutlined />} onClick={() => void openMerge()}>
            Merge into…
          </Button>
        ) : null}
        {productId ? (
          <Popconfirm
            title="Delete this product and all its batches?"
            onConfirm={async () => {
              try {
                await deleteProduct(productId);
                message.success("Deleted");
                navigate("/");
              } catch (err) {
                message.error(err instanceof Error ? err.message : "Delete failed");
              }
            }}
          >
            <Button danger icon={<DeleteOutlined />}>
              Delete
            </Button>
          </Popconfirm>
        ) : null}
      </PageActions>
      <p className="page-subheading">
        {product
          ? `${product.category} · every purchase of this product, and its details.`
          : "Edit the product and manage its purchase batches."}
      </p>

      {product ? (
        <div className="summary-strip">
          <div className="summary-cell">
            <div className="label">On hand</div>
            <div className="value" style={{ color: "var(--pantry-primary-deep)" }}>
              {product.on_hand}
            </div>
          </div>
          <div className="summary-cell">
            <div className="label">Purchases</div>
            <div className="value">{product.purchase_count}</div>
          </div>
          <div className="summary-cell">
            <div className="label">Companies</div>
            <div className="value small" title={product.companies.join(", ")}>
              {product.companies.length ? product.companies.join(", ") : "—"}
            </div>
          </div>
          <div className="summary-cell">
            <div className="label">Next expiry</div>
            <div className="value small">
              <span
                className={`expiry-pill ${expiryTone(product.next_expiry)}`}
                title={product.next_expiry || undefined}
              >
                <ClockCircleOutlined />
                {expiryLabel(product.next_expiry)}
              </span>
            </div>
          </div>
        </div>
      ) : null}

      <Card
        title="Purchase batches"
        className="surface-card"
        style={{ marginBottom: 18 }}
        extra={
          <Button type="primary" icon={<PlusOutlined />} onClick={openAddBatch}>
            Add purchase
          </Button>
        }
      >
        {isPhone ? (
          batchCards(inStock, "Nothing in stock")
        ) : (
          <Table
            size="middle"
            rowKey="batch_id"
            columns={batchColumns}
            dataSource={inStock}
            locale={{ emptyText: "Nothing in stock" }}
            pagination={false}
            scroll={{ x: 1000 }}
          />
        )}
        {usedUp.length ? (
          <Collapse
            ghost
            className="more-fields used-up"
            items={[
              {
                key: "used",
                label: `Used up (${usedUp.length})`,
                children: isPhone ? (
                  batchCards(usedUp)
                ) : (
                  <Table
                    showHeader={false}
                    size="middle"
                    rowKey="batch_id"
                    columns={batchColumns}
                    dataSource={usedUp}
                    pagination={false}
                    scroll={{ x: 1000 }}
                  />
                ),
              },
            ]}
          />
        ) : null}
      </Card>

      <Card title="History" className="surface-card" style={{ marginBottom: 18 }}>
        {events.length ? (
          <ul className="history-list">
            {events.map((event) => (
              <li key={event.event_id}>
                <span className={`history-delta ${event.delta < 0 ? "down" : "up"}`}>
                  {event.delta > 0 ? `+${event.delta}` : event.delta}
                </span>
                <span className="history-what">
                  <strong>{EVENT_LABELS[event.kind] ?? event.kind}</strong>
                  <span>
                    {event.detail || "Purchase"}
                    {event.batch_id ? <span className="batch-id"> · #{event.batch_id}</span> : null}
                  </span>
                  <span>
                    {event.count_after - event.delta} → {event.count_after} left in this purchase
                  </span>
                </span>
                <span className="history-when">
                  <span>
                    {dayjs(event.created_at).format("D MMM YYYY, HH:mm")}
                    {event.actor ? ` · ${event.actor}` : ""}
                  </span>
                  {event.can_undo ? (
                    <Popconfirm
                      title="Undo this entry?"
                      description="The count goes back and this entry is removed."
                      onConfirm={() => void onUndoEvent(event)}
                    >
                      <Button size="small">Undo</Button>
                    </Popconfirm>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="import-help">
            Nothing recorded yet. Purchases and every change in count show up here.
          </p>
        )}
      </Card>

      <Card title="Edit details" loading={loading} className="surface-card">
        <Form
          form={productForm}
          layout="vertical"
          onFinish={(values) => void onSaveProduct(values)}
        >
          <div className="form-row">
            <Form.Item
              name="name"
              label="Product name"
              className="form-field-wide"
              rules={[{ required: true, message: "Name is required" }]}
            >
              <Input />
            </Form.Item>
            <Form.Item name="category" label="Category" className="form-field-wide">
              <Select
                options={(catalog?.categories ?? []).map((value) => ({
                  value,
                  label: value,
                }))}
              />
            </Form.Item>
          </div>
          <Form.Item name="notes" label="Notes (symptoms / use)">
            <Input.TextArea rows={3} />
          </Form.Item>
          <Button type="primary" htmlType="submit">
            Save product
          </Button>
        </Form>
      </Card>

      <Modal
        title={`Merge ${product?.name ?? "this product"} into…`}
        open={mergeOpen}
        onCancel={() => setMergeOpen(false)}
        onOk={() => void onMerge()}
        okText="Merge"
        okButtonProps={{ disabled: !mergeTarget, loading: mergeBusy }}
        destroyOnClose
      >
        <Typography.Paragraph type="secondary">
          All {product?.purchase_count ?? 0} purchase(s) move to the product you pick, and this
          product is removed.
        </Typography.Paragraph>
        <Select
          showSearch
          className="form-field-wide"
          style={{ width: "100%" }}
          placeholder="Search products"
          value={mergeTarget}
          onChange={setMergeTarget}
          optionFilterProp="label"
          options={mergeOptions.map((p) => ({
            value: p.product_id,
            label: `${p.name} (${p.category}) · ${p.purchase_count} purchase(s)`,
          }))}
        />
      </Modal>

      <Modal
        title={editingBatch ? "Edit batch" : "Add purchase"}
        open={batchModalOpen}
        onCancel={() => setBatchModalOpen(false)}
        footer={null}
        destroyOnClose
      >
        <Form
          form={batchForm}
          layout="vertical"
          onFinish={(values) => void onSaveBatch(values)}
        >
          <Form.Item name="company" label="Company / brand">
            <AutoComplete
              options={companyOptions}
              filterOption={matchesTyped}
              placeholder="Optional"
              allowClear
            />
          </Form.Item>
          <div className="form-row">
            <Form.Item name="location" label="Location" className="form-field-half">
              <Select options={optionsOf(catalog?.locations)} />
            </Form.Item>
            <Form.Item name="package_type" label="Package" className="form-field-half">
              <Select options={optionsOf(catalog?.package_types)} />
            </Form.Item>
          </div>
          <div className="form-row">
            <Form.Item name="package_count" label="Count" className="form-field-count">
              <InputNumber min={0} style={{ width: "100%" }} />
            </Form.Item>
            <Form.Item label="Size" className="form-field-half">
              {sizeField(false)}
            </Form.Item>
          </div>
          <Form.Item name="expiry" label="Expiry">
            <DatePicker style={{ width: "100%" }} />
          </Form.Item>
          <Collapse
            ghost
            className="more-fields"
            activeKey={moreOpen ? ["more"] : []}
            onChange={(keys) => setMoreOpen(keys.length > 0)}
            items={[
              {
                key: "more",
                label: "More details",
                forceRender: true,
                children: (
                  <>
                    <div className="form-row">
                      <Form.Item
                        name="units_per_package"
                        label="Units per pack"
                        className="form-field-half"
                        tooltip="Pieces inside one package, e.g. tablets per strip."
                      >
                        <Input inputMode="numeric" />
                      </Form.Item>
                      <Form.Item name="acquired" label="Acquired" className="form-field-half">
                        <DatePicker style={{ width: "100%" }} />
                      </Form.Item>
                    </div>
                    <Form.Item
                      name="notes"
                      label="Note for this batch"
                      tooltip="What makes this batch different, e.g. sliced, baked, chopped."
                    >
                      <Input placeholder="Optional, e.g. Sliced" allowClear />
                    </Form.Item>
                  </>
                ),
              },
            ]}
          />
          <Space>
            <Button type="primary" htmlType="submit" loading={batchBusy}>
              Save
            </Button>
            <Button onClick={() => setBatchModalOpen(false)}>Cancel</Button>
          </Space>
        </Form>
      </Modal>
    </>
  );
}
