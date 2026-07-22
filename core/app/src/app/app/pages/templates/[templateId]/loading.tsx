import { LoadingState } from "@/components/desktop-v72/loading-state";
import { PageSurface } from "@/components/desktop-v72/primitives";

export default function TemplateDetailLoading() {
  return <PageSurface className="page-template-detail" width="wide">
    <LoadingState label="正在打开模板" />
  </PageSurface>;
}
