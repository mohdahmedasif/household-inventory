import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  Alert,
  App as AntdApp,
  Button,
  Card,
  DatePicker,
  Form,
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
  CopyOutlined,
  DeleteOutlined,
  EditOutlined,
  MergeCellsOutlined,
  PlusOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import PageActions, { usePageTitle } from "../layout/PageActions";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import type { ColumnsType } from "antd/es/table";
import {
  addBatch,
  createProduct,
  deleteBatch,
  deleteProduct,
  extractFromImage,
  fetchCatalog,
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

type NewProductForm = ProductCreateInput & {
  expiry?: Dayjs | null;
};

const EVENT_LABELS: Record<StockEvent["kind"], string> = {
  purchase: "Purchased",
  used: "Used",
  added: "Count raised",
  removed: "Batch deleted",
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
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState("");
  const [photoCaption, setPhotoCaption] = useState("");
  const [extracting, setExtracting] = useState(false);
  const [events, setEvents] = useState<StockEvent[]>([]);
  const addAnother = useRef(false);
  usePageTitle(editing ? product?.name : undefined);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  function pickPhoto(file: File) {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
    void onExtractPhoto(file);
  }

  function clearPhoto() {
    if (photoPreview) URL.revokeObjectURL(photoPreview);
    setPhotoFile(null);
    setPhotoPreview("");
  }

  async function onExtractPhoto(file: File | null = photoFile) {
    if (!file) {
      message.warning("Choose a photo first");
      return;
    }
    setExtracting(true);
    try {
      const { item } = await extractFromImage(file, photoCaption);
      newForm.setFieldsValue({
        ...item,
        expiry: item.expiry_date ? dayjs(item.expiry_date) : null,
      });
      lookupSimilar(item.name ?? "", item.category ?? "");
      message.success("Details filled from photo — review and save");
    } catch (err) {
      message.error(err instanceof Error ? err.message : "Could not read that photo");
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
        if (editing && productId) {
          await reload(productId);
        } else {
          newForm.setFieldsValue({
            ...emptyProductInput(),
            category: cat.defaults?.category ?? "Canned Goods",
            location: cat.defaults?.location ?? "Kitchen Cabinet",
            package_type: cat.defaults?.package_type ?? "Pack",
          });
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
    newForm.resetFields();
    newForm.setFieldsValue({
      ...emptyProductInput(),
      category: catalog?.defaults?.category ?? "Canned Goods",
      location: catalog?.defaults?.location ?? "Kitchen Cabinet",
      package_type: catalog?.defaults?.package_type ?? "Pack",
    });
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
      location: last?.location || (catalog?.defaults?.location ?? "Kitchen Cabinet"),
      package_type: last?.package_type || (catalog?.defaults?.package_type ?? "Pack"),
      units_per_package: last?.units_per_package ?? "",
      size_value: last?.size_value ?? "",
      size_unit: last?.size_unit ?? "",
      package_count: 1,
      notes: "",
      expiry: null,
      acquired: dayjs(),
    });
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
        <span>
          {row.package_type}
          {sizeLabel(row) ? ` · ${sizeLabel(row)}` : ""}
        </span>
      ),
    },
    {
      title: "Count",
      dataIndex: "package_count",
      width: 90,
      render: (count: number) => <strong>{count}</strong>,
    },
    {
      title: "Note",
      dataIndex: "notes",
      width: 190,
      render: (value: string, row) => (
        <Typography.Text
          className={value ? "batch-note" : "batch-note empty"}
          editable={{
            tooltip: "Edit note",
            text: value,
            onChange: (next) => void onSaveNote(row, next),
          }}
        >
          {value || "Add note"}
        </Typography.Text>
      ),
    },
    {
      title: "Expiry",
      dataIndex: "expiry_date",
      width: 150,
      render: (value: string) => (
        <span className={`expiry-pill ${expiryTone(value)}`} title={value || undefined}>
          <ClockCircleOutlined />
          {expiryLabel(value)}
        </span>
      ),
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
      render: (_: unknown, row) => (
        <Space size={2}>
          <Tooltip title="Copy as new purchase">
            <Button
              type="text"
              icon={<CopyOutlined />}
              aria-label="Copy as new purchase"
              onClick={() => openCopyBatch(row)}
            />
          </Tooltip>
          <Tooltip title="Edit purchase">
            <Button type="text" icon={<EditOutlined />} onClick={() => openEditBatch(row)} />
          </Tooltip>
          <Popconfirm
            title="Delete this purchase batch?"
            description="If it is the last batch, the product is removed too."
            onConfirm={() => void onDeleteBatch(row)}
          >
            <Button type="text" danger icon={<DeleteOutlined />} aria-label="Delete purchase" />
          </Popconfirm>
        </Space>
      ),
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
              <Upload.Dragger
                accept="image/jpeg,image/png,image/webp"
                multiple={false}
                showUploadList={false}
                disabled={extracting}
                beforeUpload={(file) => {
                  pickPhoto(file);
                  return false;
                }}
              >
                {photoPreview ? (
                  <div className="extract-preview">
                    <img src={photoPreview} alt="Selected label" />
                    <span>{photoFile?.name}</span>
                  </div>
                ) : (
                  <>
                    <p className="ant-upload-drag-icon">
                      <CameraOutlined />
                    </p>
                    <p className="ant-upload-text">Choose or drop a product photo</p>
                    <p className="ant-upload-hint">It is read as soon as you pick it</p>
                  </>
                )}
              </Upload.Dragger>
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
                    accept="image/jpeg,image/png,image/webp"
                    capture="environment"
                    multiple={false}
                    showUploadList={false}
                    disabled={extracting}
                    beforeUpload={(file) => {
                      pickPhoto(file);
                      return false;
                    }}
                  >
                    <Button
                      type="primary"
                      size="large"
                      icon={<CameraOutlined />}
                      loading={extracting}
                      block
                    >
                      {extracting ? "Reading…" : "Take photo"}
                    </Button>
                  </Upload>
                  {photoFile ? (
                    <Button
                      size="large"
                      icon={<ThunderboltOutlined />}
                      disabled={extracting}
                      onClick={() => void onExtractPhoto()}
                      block
                    >
                      Read again
                    </Button>
                  ) : null}
                  {photoFile ? (
                    <Button size="large" disabled={extracting} onClick={clearPhoto} block>
                      Clear photo
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
                    <Input size="large" placeholder="e.g. Freshona" />
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
                  <Form.Item name="units_per_package" label="Units / pack" className="form-field-narrow">
                    <Input size="large" placeholder="10" />
                  </Form.Item>
                  <Form.Item name="size_value" label="Size" className="form-field-narrow">
                    <Input size="large" placeholder="500" />
                  </Form.Item>
                  <Form.Item name="size_unit" label="Unit" className="form-field-narrow">
                    <Input size="large" placeholder="g" />
                  </Form.Item>
                  <Form.Item
                    name="batch_notes"
                    label="Batch note"
                    className="form-field-wide"
                    tooltip="What makes this batch different, e.g. sliced, baked, chopped."
                  >
                    <Input size="large" placeholder="Optional, e.g. Sliced" allowClear />
                  </Form.Item>
                  <Form.Item name="expiry" label="Expiry" className="form-field-wide">
                    <DatePicker size="large" style={{ width: "100%" }} />
                  </Form.Item>
                </div>
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
        <Table
          size="middle"
          rowKey="batch_id"
          columns={batchColumns}
          dataSource={product?.batches ?? []}
          pagination={false}
          scroll={{ x: 1000 }}
        />
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
                  {EVENT_LABELS[event.kind] ?? event.kind}
                  {event.batch_id ? <span className="batch-id"> · #{event.batch_id}</span> : null}
                </span>
                <span className="history-when">
                  {dayjs(event.created_at).format("D MMM YYYY, HH:mm")}
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
          product is removed. Each moved purchase is noted with its original name.
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
            <Input />
          </Form.Item>
          <Form.Item name="location" label="Location">
            <Select
              options={(catalog?.locations ?? []).map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Form.Item name="package_type" label="Package type">
            <Select
              options={(catalog?.package_types ?? []).map((value) => ({
                value,
                label: value,
              }))}
            />
          </Form.Item>
          <Space wrap size="large" className="form-row">
            <Form.Item name="package_count" label="Count">
              <InputNumber min={0} />
            </Form.Item>
            <Form.Item name="units_per_package" label="Units / pack">
              <Input />
            </Form.Item>
            <Form.Item name="size_value" label="Size">
              <Input />
            </Form.Item>
            <Form.Item name="size_unit" label="Unit">
              <Input />
            </Form.Item>
          </Space>
          <Form.Item
            name="notes"
            label="Note for this batch"
            tooltip="What makes this batch different, e.g. sliced, baked, chopped."
          >
            <Input placeholder="Optional, e.g. Sliced" allowClear />
          </Form.Item>
          <Form.Item name="expiry" label="Expiry">
            <DatePicker />
          </Form.Item>
          <Form.Item name="acquired" label="Acquired">
            <DatePicker />
          </Form.Item>
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
