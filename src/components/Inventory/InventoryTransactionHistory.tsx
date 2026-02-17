import React, { useState, useEffect } from 'react';
import { database, InventoryItem, InventoryTransaction } from '../../utils/supabase';
import {
  X,
  History,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  Filter,
  Download,
  Calendar,
  User,
  Package,
} from 'lucide-react';

interface InventoryTransactionHistoryProps {
  item: InventoryItem;
  onClose: () => void;
}

const InventoryTransactionHistory: React.FC<InventoryTransactionHistoryProps> = ({
  item,
  onClose,
}) => {
  const [transactions, setTransactions] = useState<InventoryTransaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterType, setFilterType] = useState<string>('all');
  const [dateRange, setDateRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  useEffect(() => {
    loadTransactions();
  }, [item.id, filterType, dateRange]);

  const loadTransactions = async () => {
    setLoading(true);
    try {
      // Calculate date filter
      let fromDate: string | undefined;
      const now = new Date();

      switch (dateRange) {
        case '7d':
          fromDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '30d':
          fromDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
          break;
        case '90d':
          fromDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
          break;
        default:
          fromDate = undefined;
      }

      const { data, error } = await database.inventory.getTransactions({
        itemId: item.id,
        type: filterType === 'all' ? undefined : filterType as 'in' | 'out' | 'adjust',
        fromDate,
        limit: 100,
      });

      if (error) throw error;
      setTransactions(data || []);
    } catch (err) {
      console.error('Error loading transactions:', err);
    } finally {
      setLoading(false);
    }
  };

  const getTransactionIcon = (type: string) => {
    switch (type) {
      case 'in':
        return <ArrowUpCircle className="h-4 w-4 text-green-600" />;
      case 'out':
        return <ArrowDownCircle className="h-4 w-4 text-red-600" />;
      case 'adjust':
        return <RefreshCw className="h-4 w-4 text-purple-600" />;
      default:
        return <Package className="h-4 w-4 text-gray-400" />;
    }
  };

  const getTransactionStyle = (type: string) => {
    switch (type) {
      case 'in':
        return {
          badge: 'bg-green-100 text-green-700',
          quantity: 'text-green-600',
          prefix: '+',
        };
      case 'out':
        return {
          badge: 'bg-red-100 text-red-700',
          quantity: 'text-red-600',
          prefix: '-',
        };
      case 'adjust':
        return {
          badge: 'bg-purple-100 text-purple-700',
          quantity: 'text-purple-600',
          prefix: '=',
        };
      default:
        return {
          badge: 'bg-gray-100 text-gray-700',
          quantity: 'text-gray-600',
          prefix: '',
        };
    }
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const handleExport = () => {
    // Export to CSV
    const headers = ['Date', 'Type', 'Quantity', 'Stock Before', 'Stock After', 'Reason', 'Reference', 'User'];
    const rows = transactions.map(t => [
      formatDate(t.created_at),
      t.type.toUpperCase(),
      t.quantity,
      t.stock_before ?? '',
      t.stock_after ?? '',
      t.reason ?? '',
      t.reference ?? '',
      t.performed_by_user?.name ?? '',
    ]);

    const csv = [headers, ...rows].map(row => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `inventory-history-${item.code || item.name}-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex-none border-b border-gray-100 px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <History className="h-5 w-5 text-blue-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-gray-900">Transaction History</h2>
              <p className="text-sm text-gray-500">
                {item.name} {item.code ? `(${item.code})` : ''}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="h-5 w-5 text-gray-500" />
          </button>
        </div>

        {/* Filters */}
        <div className="flex-none px-6 py-4 bg-gray-50 border-b border-gray-100 flex flex-wrap items-center gap-4">
          {/* Type Filter */}
          <div className="flex items-center gap-2">
            <Filter className="h-4 w-4 text-gray-400" />
            <select
              value={filterType}
              onChange={(e) => setFilterType(e.target.value)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All Types</option>
              <option value="in">Stock In</option>
              <option value="out">Stock Out</option>
              <option value="adjust">Adjustments</option>
            </select>
          </div>

          {/* Date Range */}
          <div className="flex items-center gap-2">
            <Calendar className="h-4 w-4 text-gray-400" />
            <select
              value={dateRange}
              onChange={(e) => setDateRange(e.target.value as any)}
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
            >
              <option value="7d">Last 7 Days</option>
              <option value="30d">Last 30 Days</option>
              <option value="90d">Last 90 Days</option>
              <option value="all">All Time</option>
            </select>
          </div>

          <div className="flex-1" />

          {/* Export */}
          <button
            onClick={handleExport}
            disabled={transactions.length === 0}
            className="inline-flex items-center px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
          >
            <Download className="h-4 w-4 mr-1" />
            Export CSV
          </button>

          {/* Refresh */}
          <button
            onClick={loadTransactions}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <RefreshCw className={`h-4 w-4 text-gray-500 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>

        {/* Current Stock Banner */}
        <div className="flex-none px-6 py-3 bg-blue-50 border-b border-blue-100">
          <div className="flex items-center justify-between">
            <span className="text-sm text-blue-700">Current Stock</span>
            <span className="font-bold text-blue-800">
              {item.current_stock} {item.unit}
            </span>
          </div>
        </div>

        {/* Transaction List */}
        <div className="flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <RefreshCw className="h-8 w-8 text-blue-600 animate-spin" />
            </div>
          ) : transactions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500">
              <History className="h-12 w-12 text-gray-300 mb-3" />
              <p>No transactions found</p>
              <p className="text-sm">Transactions will appear here when stock changes occur</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-100">
              {transactions.map((transaction) => {
                const style = getTransactionStyle(transaction.type);

                return (
                  <div
                    key={transaction.id}
                    className="px-6 py-4 hover:bg-gray-50 transition-colors"
                  >
                    <div className="flex items-start gap-4">
                      {/* Icon */}
                      <div className="flex-none mt-1">
                        {getTransactionIcon(transaction.type)}
                      </div>

                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${style.badge}`}>
                            {transaction.type === 'in' ? 'STOCK IN' :
                             transaction.type === 'out' ? 'STOCK OUT' :
                             'ADJUSTMENT'}
                          </span>
                          <span className={`font-semibold ${style.quantity}`}>
                            {style.prefix}{Math.abs(transaction.quantity)} {item.unit}
                          </span>
                        </div>

                        {/* Reason */}
                        <p className="text-sm text-gray-700 mb-1">
                          {transaction.reason || 'No reason provided'}
                        </p>

                        {/* Meta info */}
                        <div className="flex flex-wrap items-center gap-3 text-xs text-gray-500">
                          <span>{formatDate(transaction.created_at)}</span>

                          {transaction.performed_by_user && (
                            <span className="flex items-center gap-1">
                              <User className="h-3 w-3" />
                              {transaction.performed_by_user.name}
                            </span>
                          )}

                          {transaction.reference && (
                            <span>Ref: {transaction.reference}</span>
                          )}

                          {transaction.batch_number && (
                            <span>Batch: {transaction.batch_number}</span>
                          )}
                        </div>
                      </div>

                      {/* Stock Change */}
                      <div className="flex-none text-right">
                        <div className="text-xs text-gray-500 mb-1">Stock</div>
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-gray-400">{transaction.stock_before ?? '?'}</span>
                          <span className="text-gray-300">→</span>
                          <span className="font-semibold text-gray-700">{transaction.stock_after ?? '?'}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-none border-t border-gray-100 px-6 py-4 flex justify-between items-center">
          <span className="text-sm text-gray-500">
            {transactions.length} transaction{transactions.length !== 1 ? 's' : ''} found
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

export default InventoryTransactionHistory;
