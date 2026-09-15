export function roundPrice(cents:number,snack:boolean){return Math.ceil((cents-1e-8)/(snack?25:1))*(snack?25:1)}
export function suggestedPrice(costCents:number,margin:number,taxPercent:number,snack:boolean){if(costCents<0||margin<0||margin>=100||taxPercent<0)return null;return roundPrice(costCents/(1-margin/100)*(1+taxPercent/100),snack)}
export function priceMargin(price:number,cost:number,taxPercent:number){const net=price/(1+taxPercent/100),profit=net-cost;return{profit,margin:net>0?profit/net*100:0}}
export function itemPerformance(data:Record<string,any>,id:string,from='',to=''){
 const start=from?Date.parse(from+'T00:00:00Z'):-Infinity,end=to?Date.parse(to+'T00:00:00Z')+86400000:Infinity;
 const orders=new Map<string,Record<string,any>>(data.orders.filter((o:Record<string,any>)=>o.status!=='void'&&o.created_at>=start&&o.created_at<end).map((o:Record<string,any>)=>[o.id,o]));
 const items=data.items.filter((i:Record<string,any>)=>i.product_id===id&&orders.has(i.order_id));let units=0,sales=0,tax=0,cost=0,unknownUnits=0,paidSales=0;
 for(const i of items){units+=i.qty;sales+=i.price*i.qty;tax+=Math.round(i.price*i.qty*i.tax_bp/(10000+i.tax_bp));if(i.cost==null)unknownUnits+=i.qty;else cost+=i.cost*i.qty;if(orders.get(i.order_id)?.status==='paid')paidSales+=i.price*i.qty}
 return{units,sales,tax,knownCost:cost,unknownUnits,profit:unknownUnits?null:sales-tax-cost,paidSales};
}
