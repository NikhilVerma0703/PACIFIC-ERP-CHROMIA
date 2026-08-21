"use client";

import { useState } from "react";

import DashboardHeader from "@/components/consumables/DashboardHeader";
import SearchFilterBar from "@/components/consumables/SearchFilterBar";
import KPICards from "@/components/consumables/KPICards";

import ConsumptionTrendChart from "@/components/consumables/ConsumptionTrendChart";
import DepartmentConsumptionChart from "@/components/consumables/DepartmentConsumptionChart";
import InventoryHealthChart from "@/components/consumables/InventoryHealthChart";
import DepletionForecastChart from "@/components/consumables/DepletionForecastChart";
import TopConsumedItemsChart from "@/components/consumables/TopConsumedItemsChart";
import MonthComparisonChart from "@/components/consumables/MonthComparisonChart";

import InventoryStockTable from "@/components/consumables/InventoryStockTable";
import LowStockAlerts from "@/components/consumables/LowStockAlerts";

import DirectMaterialsTable from "@/components/consumables/DirectMaterialsTable";
import ProductionConsumablesTable from "@/components/consumables/ProductionConsumablesTable";
import PolishingConsumablesTable from "@/components/consumables/PolishingConsumablesTable";

import FilmRollTrackingTable from "@/components/consumables/FilmRollTrackingTable";

import DepartmentCards from "@/components/consumables/DepartmentCards";

import RecentConsumptionTable from "@/components/consumables/RecentConsumptionTable";

import AddInventoryModal from "@/components/consumables/AddInventoryModal";
import AddConsumptionModal from "@/components/consumables/AddConsumptionModal";
import { ToastProvider } from "@/components/consumables/toast-context";
import { WriteAccessProvider } from "@/components/consumables/write-access";

export interface Filters {
  search: string;
  category: string;
  department: string;
  dateFrom: string;
  dateTo: string;
}

// canWrite has NO default: the page must state the tier. Defaulting it to true
// would make this the one fail-open link in a chain whose every other link
// (write-access.tsx, consumablesGate) fails closed - and a caller that forgot
// to pass it would silently show write controls to a read-only login.
export default function ConsumablesDashboard({ canWrite }: { canWrite: boolean }) {
  const [isInventoryModalOpen, setIsInventoryModalOpen] = useState(false);
  const [isConsumptionModalOpen, setIsConsumptionModalOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [filters, setFilters] = useState<Filters>({
    search: "",
    category: "All",
    department: "All",
    dateFrom: "",
    dateTo: "",
  });

  const handleSuccess = () => setRefreshKey((k) => k + 1);

  const handleExportConsumption = () => {
    const params = new URLSearchParams();
    if (filters.search) params.set("search", filters.search);
    if (filters.department !== "All") params.set("department", filters.department);
    if (filters.dateFrom) params.set("dateFrom", filters.dateFrom);
    if (filters.dateTo) params.set("dateTo", filters.dateTo);
    window.location.href = `/api/consumables/export/consumption?${params.toString()}`;
  };

  const handleExportInventory = () => {
    window.location.href = "/api/consumables/export/inventory";
  };

  // Hide category-specific tables when a different category is selected
  const showDirect =
    filters.category === "All" || filters.category === "Direct Materials";
  const showProduction =
    filters.category === "All" || filters.category === "Production Consumables";
  const showPolishing =
    filters.category === "All" || filters.category === "Polishing Consumables";

  return (
    <WriteAccessProvider canWrite={canWrite}>
      <ToastProvider>
        <div className="-mx-2 sm:mx-0">
          <div className="max-w-7xl mx-auto space-y-6">
            {/* Header */}
            <DashboardHeader
              onAddInventory={() => setIsInventoryModalOpen(true)}
              onAddConsumption={() => setIsConsumptionModalOpen(true)}
              onExportConsumption={handleExportConsumption}
              onExportInventory={handleExportInventory}
            />

            {/* Search & Filters */}
            <SearchFilterBar filters={filters} onFiltersChange={setFilters} />

            {/* KPI Cards */}
            <KPICards key={`kpi-${refreshKey}`} />

            {/* Analytics Charts */}
            <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
              <ConsumptionTrendChart />
              <DepartmentConsumptionChart />
              <InventoryHealthChart />
            </div>

            {/* Stock Depletion Forecast */}
            <DepletionForecastChart />

            {/* Top Consumed Items + Month-over-Month */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
              <TopConsumedItemsChart />
              <MonthComparisonChart />
            </div>

            {/* Inventory Stock */}
            <InventoryStockTable key={`inv-${refreshKey}`} filters={filters} />

            {/* Low Stock Alerts */}
            <LowStockAlerts key={`low-${refreshKey}`} filters={filters} />

            {/* Direct Materials */}
            {showDirect && <DirectMaterialsTable filters={filters} />}

            {/* Production Consumables */}
            {showProduction && <ProductionConsumablesTable filters={filters} />}

            {/* Polishing Consumables */}
            {showPolishing && <PolishingConsumablesTable filters={filters} />}

            {/* Film Roll Tracking */}
            <FilmRollTrackingTable filters={filters} />

            {/* Department Mapping */}
            <DepartmentCards />

            {/* Recent Consumption Entries */}
            <RecentConsumptionTable key={`cons-${refreshKey}`} filters={filters} />
          </div>
        </div>

        {/* Add Inventory Modal - not mounted at all for a VIEW-only login. */}
        {canWrite && (
          <AddInventoryModal
            isOpen={isInventoryModalOpen}
            onClose={() => setIsInventoryModalOpen(false)}
            onSuccess={handleSuccess}
          />
        )}

        {/* Add Consumption Modal - see above. */}
        {canWrite && (
          <AddConsumptionModal
            isOpen={isConsumptionModalOpen}
            onClose={() => setIsConsumptionModalOpen(false)}
            onSuccess={handleSuccess}
          />
        )}
      </ToastProvider>
    </WriteAccessProvider>
  );
}
